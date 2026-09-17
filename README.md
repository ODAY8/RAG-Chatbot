# RAG Chatbot — Hands-on companion to "The Imitation Game" Day 01

This is a minimal, working Retrieval-Augmented Generation (RAG) chatbot built
with **LangChain** and **ChromaDB**. It implements exactly the pipeline
described in the KIIT Robotics Society workshop deck:

```
Documents → Chunking → Embeddings → Vector Database   (ingest.py — Indexing Phase)
User Question → Embedding → Similarity Search → Top-K Chunks
                                                    ↓
                                Retrieved Context → LLM → Grounded Response
                                                            (chat.py — Retrieval + Generation)
```

## Project structure

```
rag_chatbot/
├── documents/              # Sample knowledge base (4 .txt files on LLMs, embeddings, RAG, agents)
├── ingest.py                # Builds the vector store (run once)
├── chat.py                  # Interactive RAG chat loop (run to ask questions)
├── requirements.txt
└── .env.example
```

## Setup

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Add your OpenAI API key:
   ```bash
   cp .env.example .env
   # then edit .env and paste your key
   ```

3. Build the knowledge base (Indexing Phase):
   ```bash
   python ingest.py
   ```
   This loads every `.txt` file in `documents/`, splits them into overlapping
   chunks using recursive character text splitting, embeds each chunk with
   OpenAI's `text-embedding-3-small`, and stores the vectors in a local
   ChromaDB folder (`chroma_db/`).

4. Chat with your documents:
   ```bash
   python chat.py
   ```
   Try questions like:
   - "What is the attention mechanism?"
   - "Why do vector databases exist?"
   - "What's the difference between short-term and long-term memory?"
   - "What is the ReAct loop?"

   At any point type `/sources` to see exactly which chunks were retrieved
   for your last question — this makes the "Retrieval Phase" visible instead
   of a black box.

## How each slide concept shows up in the code

| Slide concept | Where it lives |
|---|---|
| Chunking (recursive character splitting, overlap) | `ingest.py` → `chunk_documents()` |
| Embeddings | `OpenAIEmbeddings(model="text-embedding-3-small")` in both files |
| Vector Database | `Chroma.from_documents(...)` in `ingest.py` |
| Similarity Search / Top-K retrieval | `db.as_retriever(search_kwargs={"k": TOP_K})` in `chat.py` |
| Grounded generation (anti-hallucination) | The system prompt in `chat.py` forces the model to answer only from retrieved context |
| Context window | The formatted retrieved chunks are what get inserted into the prompt sent to the LLM |

## Suggested next steps (to bridge toward Section 7 — AI Agents)

Once this feels solid, the natural extension is turning this RAG system into
an **agent** by adding tools around it — e.g.:
- A calculator tool for numeric questions
- A web search tool for questions outside the knowledge base
- Short-term memory (conversation history) so follow-up questions work
  ("compare it with the RAG section" referring to a previous answer)

That would implement the `Agent = LLM + Tools + Memory + Knowledge` formula
from the closing slide. Happy to build that next if you want to keep going.

## Notes

- Add your own `.txt`/`.md`/`.pdf` files to `documents/` and re-run
  `ingest.py` to build a knowledge base on any topic you want.
- Swap `gpt-4o-mini` for any other OpenAI chat model in `chat.py` if you like.
- This uses a **local, persistent** Chroma store — no external vector DB
  service needed.
