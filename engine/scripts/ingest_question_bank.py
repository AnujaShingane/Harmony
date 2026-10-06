from __future__ import annotations

import re
import uuid
from pathlib import Path

from qdrant_client.models import PointStruct

from app.core.config import settings
from app.retrieval.embeddings import BGE_M3_Embedder
from app.retrieval.qdrant_client import get_qdrant_client


PROJECT_ROOT = Path(__file__).resolve().parents[1]

QUESTION_BANK_PATH = (
    PROJECT_ROOT
    / "knowledge_base"
    / "ANAHAT_KnowledgeBase_v3"
    / "rag"
    / "question_bank"
)

COLLECTION = "anahat_knowledge"
EXPECTED_FILES = 17
EXPECTED_DIMENSION = 1024


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """
    Parse simple YAML-style frontmatter from canonical
    ANAHAT question-bank markdown files.
    """

    if not text.startswith("---"):
        raise ValueError("Missing frontmatter")

    parts = text.split("---", 2)

    if len(parts) != 3:
        raise ValueError("Invalid frontmatter format")

    raw_frontmatter = parts[1].strip()
    body = parts[2].strip()

    metadata = {}

    for line in raw_frontmatter.splitlines():

        line = line.strip()

        if not line or ":" not in line:
            continue

        key, value = line.split(":", 1)

        key = key.strip()
        value = value.strip()

        if value.lower() == "true":
            value = True
        elif value.lower() == "false":
            value = False

        metadata[key] = value

    return metadata, body


def normalize_text(text: str) -> str:

    text = text.replace("\r\n", "\n")
    text = text.replace("\r", "\n")

    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


def main():

    print("=" * 70)
    print("ANAHAT QUESTION BANK QDRANT INGESTION")
    print("=" * 70)

    files = sorted(QUESTION_BANK_PATH.glob("*.md"))

    print(f"Question-bank files found: {len(files)}")

    if len(files) != EXPECTED_FILES:
        raise RuntimeError(
            f"Expected {EXPECTED_FILES} question-bank files, "
            f"found {len(files)}"
        )

    client = get_qdrant_client()

    collection = client.get_collection(COLLECTION)

    dimension = collection.config.params.vectors.size

    print(f"Collection: {COLLECTION}")
    print(f"Existing points: {collection.points_count}")
    print(f"Vector dimension: {dimension}")

    if dimension != EXPECTED_DIMENSION:
        raise RuntimeError(
            f"Expected dimension {EXPECTED_DIMENSION}, "
            f"found {dimension}"
        )

    records = []

    for path in files:

        raw_text = path.read_text(
            encoding="utf-8",
            errors="replace",
        )

        metadata, body = parse_frontmatter(raw_text)

        body = normalize_text(body)

        if metadata.get("document_type") != "question_bank":
            raise RuntimeError(
                f"{path.name}: document_type is not question_bank"
            )

        if metadata.get("knowledge_category") != "assessment_question":
            raise RuntimeError(
                f"{path.name}: invalid knowledge_category"
            )

        if metadata.get("canonical_version") is not True:
            raise RuntimeError(
                f"{path.name}: canonical_version is not true"
            )

        quadrant = str(
            metadata.get("quadrant_alignment", "")
        ).strip().lower()

        if not quadrant:
            raise RuntimeError(
                f"{path.name}: missing quadrant_alignment"
            )

        if not body:
            raise RuntimeError(
                f"{path.name}: empty question-bank body"
            )

        document_id = (
            "rag__question_bank__"
            + path.stem.lower()
        )

        chunk_id = document_id + ":00000"

        payload = {
            "chunk_id": chunk_id,
            "document_id": document_id,
            "source_file": path.name,
            "source_path": str(
                path.relative_to(PROJECT_ROOT)
            ).replace("\\", "/"),
            "knowledge_type": "question_bank",
            "knowledge_category": metadata[
                "knowledge_category"
            ],
            "document_type": metadata[
                "document_type"
            ],
            "quadrant_alignment": quadrant,
            "source_document": metadata.get(
                "source_document"
            ),
            "canonical_version": metadata[
                "canonical_version"
            ],
            "evidence_level": metadata.get(
                "evidence_level"
            ),
            "version": metadata.get("version"),
            "text": body,
            "embedding_model": settings.embedding_model,
            "vector_dimension": EXPECTED_DIMENSION,
        }

        records.append(
            {
                "chunk_id": chunk_id,
                "text": body,
                "payload": payload,
            }
        )

        print(
            f"READY: {path.name} "
            f"-> quadrant={quadrant}"
        )

    print()
    print(f"Validated question-bank records: {len(records)}")

    embedder = BGE_M3_Embedder()

    texts = [
        record["text"]
        for record in records
    ]

    print("Generating BGE-M3 embeddings...")

    vectors = embedder.encode_documents(texts)

    if len(vectors) != len(records):
        raise RuntimeError(
            f"Embedding count mismatch: "
            f"{len(vectors)} vs {len(records)}"
        )

    if vectors.shape[1] != EXPECTED_DIMENSION:
        raise RuntimeError(
            f"Embedding dimension mismatch: "
            f"{vectors.shape[1]} vs {EXPECTED_DIMENSION}"
        )

    points = []

    for record, vector in zip(records, vectors):

        point_id = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                "anahat:question_bank:"
                + record["chunk_id"],
            )
        )

        points.append(
            PointStruct(
                id=point_id,
                vector=vector.tolist(),
                payload=record["payload"],
            )
        )

    print(f"Upserting {len(points)} question-bank points...")

    client.upsert(
        collection_name=COLLECTION,
        points=points,
        wait=True,
    )

    final_info = client.get_collection(COLLECTION)

    print()
    print("=" * 70)
    print("QUESTION BANK INGESTION COMPLETE")
    print("=" * 70)
    print(f"Collection: {COLLECTION}")
    print(f"Previous points: {collection.points_count}")
    print(f"Question-bank points added: {len(points)}")
    print(f"Final points: {final_info.points_count}")
    print("=" * 70)

    if final_info.points_count < len(points):
        raise RuntimeError(
            "Unexpected final Qdrant point count"
        )

    print("Verification: PASS")


if __name__ == "__main__":
    main()