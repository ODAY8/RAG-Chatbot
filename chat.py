"""
Chat script — the "Retrieval Phase" + "Generation Phase" of the RAG pipeline.

    User Question → Embedding → Similarity Search → Top-K Chunks
                                                          ↓
                                        Retrieved Context → LLM → Grounded Response

Run `python ingest.py` first to build the knowledge base, then run this.
"""

import os

from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough

load_dotenv()

DB_DIR = "chroma_db"
TOP_K = 3  # how many chunks to retrieve per question

SYSTEM_PROMPT = """You are a helpful assistant answering questions about \
Generative AI, LLMs, embeddings, RAG, and AI agents.

Answer ONLY using the context provided below. If the answer is not contained \
in the context, say "I don't have that in my knowledge base" instead of \
guessing.

Context:
{context}
"""


def format_docs(docs):
    return "\n\n---\n\n".join(d.page_content for d in docs)


def build_chain(retriever, llm):
    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT),
        ("human", "{question}"),
    ])

    chain = (
        {"context": retriever | format_docs, "question": RunnablePassthrough()}
        | prompt
        | llm
        | StrOutputParser()
    )
    return chain


def main():
    if not os.getenv("GROQ_API_KEY"):
        raise SystemExit(
            "GROQ_API_KEY is not set. Add your Groq API key to the .env file."
        )
    if not os.path.exists(DB_DIR):
        raise SystemExit(
            "No vector store found. Run `python ingest.py` first to build "
            "the knowledge base."
        )

    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )
    db = Chroma(persist_directory=DB_DIR, embedding_function=embeddings)
    retriever = db.as_retriever(search_kwargs={"k": TOP_K})

    llm = ChatGroq(
        model="openai/gpt-oss-120b",
        temperature=0.2,
        groq_api_key=os.getenv("GROQ_API_KEY"),
    )
    chain = build_chain(retriever, llm)

    print("RAG Chatbot ready. Ask about LLMs, embeddings, RAG, or AI agents.")
    print("Type 'exit' to quit, or '/sources' to see the last retrieved chunks.\n")

    last_docs = []
    while True:
        query = input("You: ").strip()
        if not query:
            continue
        if query.lower() in {"exit", "quit"}:
            break
        if query == "/sources":
            if not last_docs:
                print("(no query run yet)\n")
                continue
            for i, d in enumerate(last_docs, 1):
                src = d.metadata.get("source", "unknown")
                print(f"\n[{i}] {src}\n{d.page_content[:200]}...")
            print()
            continue

        # Retrieval phase (shown explicitly here so you can inspect it)
        last_docs = retriever.invoke(query)

        # Generation phase
        answer = chain.invoke(query)
        print(f"\nBot: {answer}\n")


if __name__ == "__main__":
    main()
