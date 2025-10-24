# collector.py
from flask import Flask, request, jsonify
from flask_cors import CORS
import csv, os

# ====== CONFIG ======
SAVE_DIR = "QualtricsTracker/logs"   # <-- your folder
os.makedirs(SAVE_DIR, exist_ok=True)
HEADER = ["timestamp_iso","url","question_id","source"]

app = Flask(__name__)
CORS(app)  # allow cross-origin from the extension

@app.get("/")
def index():
    return "URL Tracker collector is running. POST JSON to /ingest", 200

# Accept POST (logs) and OPTIONS (preflight), with and without trailing slash
@app.route("/ingest", methods=["POST", "OPTIONS"])
@app.route("/ingest/", methods=["POST", "OPTIONS"])
def ingest():
    if request.method == "OPTIONS":
        return ("", 204)

    data = request.get_json(silent=True) or {}
    events = data.get("events", [])
    print(f"[collector] received {len(events)} events", flush=True)

    for ev in events:
        path = os.path.join(SAVE_DIR, f"{ev.get('prolificId')}.csv")
        is_new = not os.path.exists(path)

        with open(path, "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if is_new:
                w.writerow(HEADER)
            w.writerow([
                ev.get("ts"),
                ev.get("url"),
                ev.get("questionId"),
                ev.get("source"),
            ])

    print(f"[collector] wrote {len(events)} events", flush=True)
    return jsonify(ok=True, saved=len(events))

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
