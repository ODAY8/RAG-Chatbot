"""
app.py — Flask API server for the RAG Document Assistant.

Endpoints:
    GET    /health
    GET    /stats
    POST   /upload
    POST   /chat
    GET    /documents
    DELETE /documents/<id>
    POST   /reindex
"""

import os
import json
import shutil
import hashlib
import logging
import datetime
import traceback
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_community.document_loaders import (
    TextLoader,
    PyPDFLoader,
    Docx2txtLoader,
)
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough

load_dotenv()

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR  = Path(__file__).parent
DOCS_DIR  = BASE_DIR / "documents"
DB_DIR    = BASE_DIR / "chroma_db"
META_FILE  = BASE_DIR / "documents_meta.json"
USERS_FILE = BASE_DIR / "users.json"
FRONTEND   = BASE_DIR / "frontend"

DOCS_DIR.mkdir(exist_ok=True)

# ── Config ─────────────────────────────────────────────────────────────────────
CHUNK_SIZE    = 500
CHUNK_OVERLAP = 75
TOP_K         = 3
GROQ_MODEL    = "openai/gpt-oss-120b"
EMBED_MODEL   = "sentence-transformers/all-MiniLM-L6-v2"
ALLOWED_EXT   = {".pdf", ".txt", ".docx", ".md"}

SYSTEM_PROMPT = (
    "You are a helpful AI Document Assistant. Answer questions based ONLY on "
    "the provided context. If the answer is not in the context, say "
    "'I don't have that information in the uploaded documents.'\n\n"
    "Context:\n{context}"
)

# ── Flask ──────────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=str(FRONTEND), static_url_path="/")
CORS(app)

# ── Lazy singletons ────────────────────────────────────────────────────────────
_embeddings = None
_db         = None


def get_embeddings() -> HuggingFaceEmbeddings:
    global _embeddings
    if _embeddings is None:
        log.info("Initialising HuggingFaceEmbeddings (%s)…", EMBED_MODEL)
        _embeddings = HuggingFaceEmbeddings(model_name=EMBED_MODEL)
        log.info("Embeddings ready.")
    return _embeddings


def get_db():
    global _db
    if _db is None and DB_DIR.exists():
        _db = Chroma(
            persist_directory=str(DB_DIR),
            embedding_function=get_embeddings(),
        )
    return _db


def invalidate_db():
    global _db
    _db = None


# ── Users helpers ─────────────────────────────────────────────────────────────
def load_users() -> dict:
    if USERS_FILE.exists():
        try:
            return json.loads(USERS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_users(users: dict):
    USERS_FILE.write_text(json.dumps(users, indent=2), encoding="utf-8")


def user_id(email: str) -> str:
    return hashlib.md5(email.lower().encode()).hexdigest()[:16]


# ── POST /auth/register ────────────────────────────────────────────────────────
@app.route("/auth/register", methods=["POST"])
def register():
    body     = request.get_json(silent=True) or {}
    name     = (body.get("name")     or "").strip()
    email    = (body.get("email")    or "").strip().lower()
    password = (body.get("password") or "").strip()

    if not name or not email or not password:
        return jsonify({"error": "Name, email and password are all required."}), 400

    import re
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email):
        return jsonify({"error": "Invalid email address."}), 400

    users = load_users()
    if email in users:
        return jsonify({"error": "An account with that email already exists."}), 409

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400

    uid = user_id(email)
    users[email] = {
        "id":           uid,
        "name":         name,
        "email":        email,
        "password_hash": generate_password_hash(password),
        "created_at":   datetime.datetime.utcnow().isoformat(),
    }
    save_users(users)
    log.info("[register] New user: %s (%s)", name, email)

    return jsonify({
        "message": "Account created successfully.",
        "user": {"id": uid, "name": name, "email": email},
    }), 201


# ── POST /auth/login ───────────────────────────────────────────────────────────
@app.route("/auth/login", methods=["POST"])
def login():
    body     = request.get_json(silent=True) or {}
    email    = (body.get("email")    or "").strip().lower()
    password = (body.get("password") or "").strip()

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    users = load_users()
    user  = users.get(email)

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password."}), 401

    log.info("[login] User signed in: %s", email)
    return jsonify({
        "message": "Signed in successfully.",
        "user": {"id": user["id"], "name": user["name"], "email": user["email"]},
    })


# ── Metadata helpers ───────────────────────────────────────────────────────────
def load_meta() -> dict:
    if META_FILE.exists():
        try:
            return json.loads(META_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_meta(meta: dict):
    META_FILE.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def file_id(filename: str) -> str:
    return hashlib.md5(filename.encode()).hexdigest()[:12]


# ── Document loader factory ────────────────────────────────────────────────────
def loader_for(path: Path):
    ext = path.suffix.lower()
    if ext == ".pdf":
        return PyPDFLoader(str(path))
    if ext == ".docx":
        return Docx2txtLoader(str(path))
    # .txt and .md both use TextLoader
    return TextLoader(str(path), encoding="utf-8")


# ── Ingest a single file ───────────────────────────────────────────────────────
def ingest_file(path: Path) -> int:
    """
    Load → split → embed → store one file.
    Returns the number of chunks added.
    Raises on any failure so the caller can return a proper error response.
    """
    log.info("[ingest] Loading %s", path.name)
    docs = loader_for(path).load()
    log.info("[ingest] Loaded %d document section(s)", len(docs))

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks = splitter.split_documents(docs)
    log.info("[ingest] Split into %d chunks", len(chunks))

    if not chunks:
        raise ValueError(f"No text could be extracted from '{path.name}'.")

    log.info("[ingest] Creating/opening ChromaDB at %s", DB_DIR)
    db = Chroma(
        persist_directory=str(DB_DIR),
        embedding_function=get_embeddings(),
    )
    log.info("[ingest] Embedding and storing chunks…")
    db.add_documents(chunks)
    log.info("[ingest] Done — %d chunks stored.", len(chunks))

    invalidate_db()
    return len(chunks)


# ── Rebuild entire index ───────────────────────────────────────────────────────
def rebuild_index() -> int:
    log.info("[rebuild] Wiping old ChromaDB…")
    if DB_DIR.exists():
        shutil.rmtree(DB_DIR)

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    all_chunks = []
    for f in DOCS_DIR.iterdir():
        if f.suffix.lower() in ALLOWED_EXT:
            log.info("[rebuild] Loading %s", f.name)
            try:
                docs = loader_for(f).load()
                all_chunks.extend(splitter.split_documents(docs))
            except Exception:
                log.warning("[rebuild] Skipping %s — load failed:\n%s", f.name, traceback.format_exc())

    if all_chunks:
        log.info("[rebuild] Embedding %d total chunks…", len(all_chunks))
        Chroma.from_documents(
            documents=all_chunks,
            embedding=get_embeddings(),
            persist_directory=str(DB_DIR),
        )
        log.info("[rebuild] Done.")
    else:
        log.warning("[rebuild] No chunks produced — index is empty.")

    invalidate_db()
    return len(all_chunks)


# ── RAG chain helpers ──────────────────────────────────────────────────────────
def format_docs(docs):
    return "\n\n---\n\n".join(d.page_content for d in docs)


def build_chain(retriever, llm):
    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        ("human", "{question}"),
    ])
    return (
        {"context": retriever | format_docs, "question": RunnablePassthrough()}
        | prompt
        | llm
        | StrOutputParser()
    )


# ── Static pages ───────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory(str(FRONTEND), "login.html")


@app.route("/<page>.html")
def page(page):
    return send_from_directory(str(FRONTEND), f"{page}.html")


# ── GET /health ────────────────────────────────────────────────────────────────
@app.route("/health")
def health():
    return jsonify({
        "status":   "ok",
        "groq_key": bool(os.getenv("GROQ_API_KEY")),
        "db_ready": DB_DIR.exists(),
    })


# ── GET /stats ─────────────────────────────────────────────────────────────────
@app.route("/stats")
def stats():
    meta         = load_meta()
    total_chunks = sum(v.get("chunks", 0) for v in meta.values())
    recent       = sorted(
        meta.values(),
        key=lambda x: x.get("uploaded_at", ""),
        reverse=True,
    )[:5]
    return jsonify({
        "total_documents": len(meta),
        "total_chunks":    total_chunks,
        "groq_model":      GROQ_MODEL,
        "embed_model":     EMBED_MODEL,
        "db_ready":        DB_DIR.exists(),
        "recent_uploads":  recent,
    })


# ── POST /upload ───────────────────────────────────────────────────────────────
@app.route("/upload", methods=["POST"])
def upload():
    log.info("[upload] Request received")

    # 1. Validate file presence
    if "file" not in request.files:
        log.warning("[upload] No file field in request")
        return jsonify({"error": "No file provided"}), 400

    f    = request.files["file"]
    name = (f.filename or "").strip()

    if not name:
        return jsonify({"error": "File has no name"}), 400

    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXT:
        return jsonify({
            "error": f"Unsupported file type '{ext}'. Allowed: PDF, DOCX, TXT, MD"
        }), 400

    # 2. Save to disk
    dest = DOCS_DIR / name
    log.info("[upload] Saving to %s", dest)
    try:
        f.save(str(dest))
        log.info("[upload] File saved (%d bytes)", dest.stat().st_size)
    except Exception:
        log.error("[upload] Failed to save file:\n%s", traceback.format_exc())
        return jsonify({"error": "Could not save file to disk"}), 500

    # 3. Ingest (load → split → embed → store)
    log.info("[upload] Starting ingestion…")
    try:
        chunk_count = ingest_file(dest)
    except Exception:
        tb = traceback.format_exc()
        log.error("[upload] Ingestion failed:\n%s", tb)
        # Remove the saved file so the user can retry cleanly
        dest.unlink(missing_ok=True)
        return jsonify({"error": f"Ingestion failed: {tb}"}), 500

    # 4. Persist metadata
    fid  = file_id(name)
    meta = load_meta()
    meta[fid] = {
        "id":          fid,
        "name":        name,
        "size":        dest.stat().st_size,
        "chunks":      chunk_count,
        "ext":         ext.lstrip(".").upper(),
        "uploaded_at": datetime.datetime.utcnow().isoformat(),
        "status":      "indexed",
    }
    save_meta(meta)
    log.info("[upload] Metadata saved for '%s' (id=%s)", name, fid)

    return jsonify({
        "message": f"'{name}' uploaded and indexed successfully.",
        "chunks":  chunk_count,
        "id":      fid,
    })


# ── POST /chat ─────────────────────────────────────────────────────────────────
@app.route("/chat", methods=["POST"])
def chat():
    body     = request.get_json(silent=True) or {}
    question = (body.get("question") or "").strip()
    model    = body.get("model", GROQ_MODEL)
    temp     = float(body.get("temperature", 0.2))
    top_k    = int(body.get("top_k", TOP_K))

    if not question:
        return jsonify({"error": "No question provided"}), 400

    if not os.getenv("GROQ_API_KEY"):
        return jsonify({"error": "GROQ_API_KEY is not set on the server"}), 500

    db = get_db()
    if db is None:
        return jsonify({
            "error": "No knowledge base found. Please upload documents first."
        }), 404

    try:
        retriever   = db.as_retriever(search_kwargs={"k": top_k})
        llm         = ChatGroq(
            model=model,
            temperature=temp,
            groq_api_key=os.getenv("GROQ_API_KEY"),
        )
        chain       = build_chain(retriever, llm)
        source_docs = retriever.invoke(question)
        answer      = chain.invoke(question)
    except Exception:
        tb = traceback.format_exc()
        log.error("[chat] Error:\n%s", tb)
        return jsonify({"error": tb}), 500

    sources = [
        {
            "source":  Path(d.metadata.get("source", "unknown")).name,
            "excerpt": d.page_content[:300],
        }
        for d in source_docs
    ]
    return jsonify({"answer": answer, "sources": sources})


# ── GET /documents ─────────────────────────────────────────────────────────────
@app.route("/documents", methods=["GET"])
def list_documents():
    return jsonify(list(load_meta().values()))


# ── DELETE /documents/<id> ─────────────────────────────────────────────────────
@app.route("/documents/<doc_id>", methods=["DELETE"])
def delete_document(doc_id):
    meta = load_meta()
    if doc_id not in meta:
        return jsonify({"error": "Document not found"}), 404

    name = meta[doc_id]["name"]
    path = DOCS_DIR / name
    path.unlink(missing_ok=True)
    del meta[doc_id]
    save_meta(meta)
    log.info("[delete] Removed '%s', rebuilding index…", name)

    try:
        rebuild_index()
    except Exception:
        tb = traceback.format_exc()
        log.error("[delete] Re-index failed:\n%s", tb)
        return jsonify({"error": f"File deleted but re-index failed: {tb}"}), 500

    return jsonify({"message": f"'{name}' deleted and index rebuilt."})


# ── POST /reindex ──────────────────────────────────────────────────────────────
@app.route("/reindex", methods=["POST"])
def reindex():
    try:
        count = rebuild_index()
        return jsonify({"message": "Re-index complete.", "chunks": count})
    except Exception:
        tb = traceback.format_exc()
        log.error("[reindex] Failed:\n%s", tb)
        return jsonify({"error": tb}), 500


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not os.getenv("GROQ_API_KEY"):
        log.warning("GROQ_API_KEY is not set — chat will not work.")
    log.info("Starting Flask on http://localhost:5000")
    # use_reloader=False prevents Werkzeug from killing the process mid-upload
    # when it detects a file change in the documents/ folder.
    app.run(debug=True, port=5000, use_reloader=False)
