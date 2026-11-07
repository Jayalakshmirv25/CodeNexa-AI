import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import torch
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from transformers import AutoModel, AutoTokenizer


def embed(code: str, tokenizer, encoder) -> np.ndarray:
    tokens = tokenizer(code, return_tensors="pt", truncation=True, max_length=512)
    with torch.no_grad():
        hidden = encoder(**tokens).last_hidden_state
        mask = tokens["attention_mask"].unsqueeze(-1)
        vector = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1)
    return vector.squeeze(0).cpu().numpy()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train a scikit-learn defect classifier from labeled Python-code JSONL."
    )
    parser.add_argument("--model", required=True, help="Local CodeBERT checkpoint directory")
    parser.add_argument("--dataset", required=True, help="JSONL file with code and label fields")
    parser.add_argument("--output", required=True, help="Output .joblib classifier path")
    args = parser.parse_args()

    tokenizer = AutoTokenizer.from_pretrained(args.model, local_files_only=True)
    encoder = AutoModel.from_pretrained(args.model, local_files_only=True)
    encoder.eval()
    vectors = []
    labels = []
    with Path(args.dataset).open(encoding="utf-8") as dataset:
        for line_number, line in enumerate(dataset, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
                code, label = record["code"], record["label"]
                if not isinstance(code, str) or not code.strip() or not isinstance(label, str) or not label.strip():
                    raise ValueError("code and label must be non-empty strings")
            except (json.JSONDecodeError, KeyError, ValueError, TypeError) as exc:
                raise SystemExit(f"Invalid dataset row {line_number}: {exc}") from exc
            vectors.append(embed(code, tokenizer, encoder))
            labels.append(label)

    if len(set(labels)) < 2:
        raise SystemExit("Training requires labeled examples from at least two classes.")
    classifier = make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=1000, class_weight="balanced"),
    )
    classifier.fit(np.asarray(vectors), np.asarray(labels))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(classifier, output)
    print(f"Saved classifier with {len(labels)} labeled examples and {len(set(labels))} classes to {output}")


if __name__ == "__main__":
    main()
