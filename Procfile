release: cd backend && flask db upgrade
web: gunicorn --worker-tmp-dir /dev/shm backend.run:app
worker: python worker/run.py