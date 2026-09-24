from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path

import numpy as np
from qdrant_client.models import Distance, PointStruct, VectorParams

# ------------------------------------------------------------------
# Project root
# ------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import settings
from app.retrieval.embeddings import BGE_M3_Embedder
from app.retrieval.qdrant_client import get_qdrant_client


# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------

COLLECTION_NAME = "anahat_indicator_validation_v1"

KB_PATH = (
    PROJECT_ROOT
    / "knowledge_base"
    / "ANAHAT_KnowledgeBase_v3"
    / "structured"
    / "symptom_to_chakra.json"
)


# ------------------------------------------------------------------
# Load canonical KB
# ------------------------------------------------------------------

def load_indicator_kb():
    if not KB_PATH.exists():
        raise FileNotFoundError(
            f"Canonical indicator KB not found: {KB_PATH}"
        )

    with KB_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        raise ValueError("symptom_to_chakra.json must contain an object.")

    entries = data.get("entries")

    if not isinstance(entries, list):
        raise ValueError("'entries' must be a list.")

    return data, entries


# ------------------------------------------------------------------
# Validate records
# ------------------------------------------------------------------

def validate_entries(entries):
    required = {
        "ailment",
        "chakra",
        "state",
        "comment",
        "id",
        "indicator_strength_by_chakra",
        "chakra_count",
        "diagnostic_type",
    }

    errors = []

    seen_ids = set()
    seen_ailments = set()

    for index, entry in enumerate(entries):
        missing = required - set(entry.keys())

        if missing:
            errors.append(
                f"Entry {index}: missing fields {sorted(missing)}"
            )

        entry_id = entry.get("id")
        ailment = entry.get("ailment")

        if entry_id in seen_ids:
            errors.append(
                f"Duplicate indicator ID: {entry_id}"
            )

        if ailment in seen_ailments:
            errors.append(
                f"Duplicate ailment: {ailment}"
            )

        seen_ids.add(entry_id)
        seen_ailments.add(ailment)

        if not isinstance(entry.get("chakra"), list):
            errors.append(
                f"{entry_id}: chakra must be a list"
            )

        if not isinstance(
            entry.get("indicator_strength_by_chakra"),
            dict,
        ):
            errors.append(
                f"{entry_id}: indicator_strength_by_chakra must be an object"
            )

    if errors:
        print("VALIDATION ERRORS:")
        for error in errors:
            print(f" - {error}")

        raise ValueError(
            f"Canonical KB validation failed with {len(errors)} error(s)."
        )

    print("Canonical indicator validation: PASS")


# ------------------------------------------------------------------
# Retrieval representation
# ------------------------------------------------------------------

def build_retrieval_text(entry):
    """
    Build semantic retrieval text.

    IMPORTANT:
    Chakra/state/strength are deliberately excluded from the
    embedding text. They remain authoritative structured metadata.
    """

    ailment = str(entry["ailment"]).strip()
    comment = str(entry.get("comment") or "").strip()

    if comment:
        return (
            f"Indicator: {ailment}\n"
            f"Context: {comment}"
        )

    return f"Indicator: {ailment}"


# ------------------------------------------------------------------
# Payload
# ------------------------------------------------------------------

def build_payload(entry, retrieval_text):
    return {
        "indicator_id": entry["id"],
        "ailment": entry["ailment"],
        "chakra": entry["chakra"],
        "state": entry["state"],
        "comment": entry["comment"],
        "chakra_count": entry["chakra_count"],
        "diagnostic_type": entry["diagnostic_type"],
        "disambiguation_pattern_id": entry.get(
            "disambiguation_pattern_id"
        ),
        "indicator_strength_by_chakra": entry[
            "indicator_strength_by_chakra"
        ],
        "source": entry.get("source"),
        "original_reference": entry.get("original_reference"),
        "clinical_disclaimer": entry.get("clinical_disclaimer"),
        "retrieval_text": retrieval_text,

        # Provenance / governance
        "retrieval_layer": "canonical_indicator",
        "chakra_mapping_source": "symptom_to_chakra.json",
        "embedding_model": settings.embedding_model,
        "vector_dimension": settings.embedding_dimension,
    }


# ------------------------------------------------------------------
# Deterministic Qdrant point ID
# ------------------------------------------------------------------

def qdrant_point_id(indicator_id):
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"anahat:indicator:{indicator_id}",
        )
    )


# ------------------------------------------------------------------
# Create collection
# ------------------------------------------------------------------

def ensure_collection(client):
    collections = client.get_collections()

    existing = {
        collection.name
        for collection in collections.collections
    }

    if COLLECTION_NAME in existing:
        print(
            f"Collection already exists: {COLLECTION_NAME}"
        )
        return

    client.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(
            size=settings.embedding_dimension,
            distance=Distance.COSINE,
        ),
    )

    print(
        f"Created collection: {COLLECTION_NAME}"
    )


# ------------------------------------------------------------------
# Vector validation
# ------------------------------------------------------------------

def validate_vectors(vectors, expected_count):
    vectors = np.asarray(vectors)

    if vectors.ndim != 2:
        raise ValueError(
            f"Expected 2D vectors, got shape {vectors.shape}"
        )

    if vectors.shape[0] != expected_count:
        raise ValueError(
            f"Expected {expected_count} vectors, "
            f"got {vectors.shape[0]}"
        )

    if vectors.shape[1] != settings.embedding_dimension:
        raise ValueError(
            f"Expected dimension {settings.embedding_dimension}, "
            f"got {vectors.shape[1]}"
        )

    if not np.isfinite(vectors).all():
        raise ValueError(
            "Vectors contain NaN or Inf values."
        )

    norms = np.linalg.norm(vectors, axis=1)

    if not np.allclose(norms, 1.0, atol=1e-4):
        raise ValueError(
            "Vectors are not L2 normalized."
        )

    print("Vector validation: PASS")


# ------------------------------------------------------------------
# Upsert
# ------------------------------------------------------------------

def main():
    print("=" * 60)
    print("ANAHAT Canonical Indicator Qdrant Validation")
    print("=" * 60)

    data, entries = load_indicator_kb()

    print(f"Schema version: {data.get('_schema_version')}")
    print(f"Canonical indicators: {len(entries)}")

    validate_entries(entries)

    retrieval_texts = [
        build_retrieval_text(entry)
        for entry in entries
    ]

    print("Loading BGE-M3...")
    embedder = BGE_M3_Embedder()

    print("Generating indicator embeddings...")

    vectors = embedder.encode_documents(
        retrieval_texts
    )

    validate_vectors(
        vectors,
        expected_count=len(entries),
    )

    client = get_qdrant_client()

    ensure_collection(client)

    points = []

    for entry, text, vector in zip(
        entries,
        retrieval_texts,
        vectors,
    ):
        points.append(
            PointStruct(
                id=qdrant_point_id(entry["id"]),
                vector=vector.tolist(),
                payload=build_payload(
                    entry,
                    text,
                ),
            )
        )

    print(
        f"Upserting {len(points)} indicator points..."
    )

    client.upsert(
        collection_name=COLLECTION_NAME,
        points=points,
        wait=True,
    )

    count = client.count(
        collection_name=COLLECTION_NAME,
        exact=True,
    ).count

    print(f"Points after upsert: {count}")

    if count != len(entries):
        raise RuntimeError(
            f"Expected {len(entries)} points, "
            f"found {count}"
        )

    # --------------------------------------------------------------
    # Payload verification
    # --------------------------------------------------------------

    stored_ids = [
        qdrant_point_id(entry["id"])
        for entry in entries
    ]

    retrieved = client.retrieve(
        collection_name=COLLECTION_NAME,
        ids=stored_ids,
        with_payload=True,
        with_vectors=False,
    )

    retrieved_ids = {
        point.payload["indicator_id"]
        for point in retrieved
    }

    expected_ids = {
        entry["id"]
        for entry in entries
    }

    if retrieved_ids != expected_ids:
        missing = expected_ids - retrieved_ids
        extra = retrieved_ids - expected_ids

        raise RuntimeError(
            f"Payload verification failed. "
            f"Missing={missing}, Extra={extra}"
        )

    print("Payload integrity: PASS")

    print("=" * 60)
    print("INDICATOR QDRANT VALIDATION: PASS")
    print("=" * 60)
    print(f"Collection: {COLLECTION_NAME}")
    print(f"Indicators: {count}")
    print(f"Dimension: {settings.embedding_dimension}")
    print("Embedding model:", settings.embedding_model)
    print("Payload integrity: PASS")


if __name__ == "__main__":
    main()