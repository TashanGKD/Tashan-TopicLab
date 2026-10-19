ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
WORKDIR /profile-hub
COPY topiclab-backend/app ./app
COPY topiclab-backend/scripts/import_profile_candidates.py ./scripts/
COPY topiclab-backend/scripts/materialize_profile_hub.py ./scripts/
COPY topiclab-backend/profile_hub_production.py .
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/profile-hub
USER 1000
CMD ["python","-m","uvicorn","profile_hub_production:app","--host","0.0.0.0","--port","8000","--workers","2","--no-access-log"]
