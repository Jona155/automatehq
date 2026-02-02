release: cd backend && flask db upgrade
web: cd backend && gunicorn --worker-tmp-dir /dev/shm run:app
worker: python worker/run.py