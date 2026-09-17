"""
Ingestion script — the "Indexing Phase" of the RAG pipeline.
"""

import os
import shutil

from dotenv import load_dotenv
from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma

load_dotenv()

DOCS_DIR = "documents"
DB_DIR = "chroma_db"

CHUNK_SIZE = 500
CHUNK_OVERLAP = 75


def load_documents():
    loader = DirectoryLoader(DOCS_DIR, glob="*.txt", loader_cls=TextLoader)
    docs = loader.load()
    print(f"Loaded {len(docs)} document(s) from '{DOCS_DIR}/'")
    return docs


def chunk_documents(docs):
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks = splitter.split_documents(docs)
    print(
        f"Split into {len(chunks)} chunk(s) "
        f"(chunk_size={CHUNK_SIZE}, overlap={CHUNK_OVERLAP})"
    )
    return chunks


def build_vector_store(chunks):
    if os.path.exists(DB_DIR):
        shutil.rmtree(DB_DIR)
        print(f"Cleared old vector store at '{DB_DIR}/'")

    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )

    db = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=DB_DIR,
    )

    print(f"Stored {len(chunks)} embedded chunks in ChromaDB at '{DB_DIR}/'")
    return db


if __name__ == "__main__":
    documents = load_documents()
    chunks = chunk_documents(documents)
    build_vector_store(chunks)
    print("\nIndexing complete. Knowledge base is ready — run chat.py next.")