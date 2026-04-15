#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="/bootstrap/runtime"
ENV_FILE="${RUNTIME_DIR}/glitchtip.env"

mkdir -p "${RUNTIME_DIR}"

python /code/manage.py bootstrap_dev

python /code/manage.py shell -c '
from apps.api_tokens.models import APIToken
from apps.projects.models import Project, ProjectKey
import shlex
from urllib.parse import urlsplit, urlunsplit

project = Project.objects.get(slug="project", organization__slug="org")
public_dsn = ProjectKey.objects.filter(project=project).first().get_dsn()
token = APIToken.objects.get(label="bootstrap_dev").token
dsn_parts = urlsplit(public_dsn)
internal_dsn = urlunsplit(
    (dsn_parts.scheme, f"{dsn_parts.username}@glitchtip-web:8000", dsn_parts.path, dsn_parts.query, dsn_parts.fragment)
)

print(f"export GLITCHTIP_DSN={shlex.quote(internal_dsn)}")
print(f"export GLITCHTIP_PUBLIC_DSN={shlex.quote(public_dsn)}")
print(f"export GLITCHTIP_API_TOKEN={shlex.quote(token)}")
print("export GLITCHTIP_ORG_SLUG=org")
print("export GLITCHTIP_PROJECT_SLUG=project")
' | grep "^export " > "${ENV_FILE}"

cat "${ENV_FILE}"
