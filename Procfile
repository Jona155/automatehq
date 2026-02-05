release: cd backend && flask --app run db upgrade heads
web: cd backend && gunicorn --worker-tmp-dir /dev/shm run:app
worker: python worker/run.py
