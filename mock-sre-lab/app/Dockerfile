FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

WORKDIR /app

COPY app/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app/entrypoint.sh /app/entrypoint.sh
COPY app/src /app/src
COPY app/tests /app/tests

EXPOSE 8080

RUN chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]
