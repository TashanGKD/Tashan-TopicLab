ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
WORKDIR /profile-hub
COPY topiclab-backend/app ./app
COPY topiclab-backend/scripts/import_profile_candidates.py ./scripts/import_profile_candidates.py
COPY topiclab-backend/profile_hub_staging.py .
COPY topiclab-backend/scripts/verify_profile_hub_staging.py ./scripts/
COPY topiclab-backend/scripts/seed_profile_hub_staging.py ./scripts/
COPY topiclab-backend/tests/test_profile_hub_regressions.py ./tests/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN python -c "import fastapi, uvicorn, sqlalchemy, psycopg2"
USER 1000
CMD ["python", "-m", "uvicorn", "profile_hub_staging:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--no-access-log"]
