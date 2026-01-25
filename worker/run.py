"""
Extraction worker — polls extraction_jobs, runs OpenCV + OpenAI Vision, updates DB.
"""
import os
import time

# Load env before any DB/openai usage
from dotenv import load_dotenv
load_dotenv()

# TODO: DB connection, job poll loop, OpenCV preprocessing, OpenAI Vision, matching


def main():
    poll_interval = int(os.environ.get("WORKER_POLL_SECONDS", "5"))
    print(f"Worker started. Polling every {poll_interval}s.")
    while True:
        # Poll extraction_jobs for status=pending, process one, update.
        time.sleep(poll_interval)


if __name__ == "__main__":
    main()
