# The OpenCV statement reader as a small HTTP service, so the app can put every
# upload in front of OpenCV (see tools/README.md).
#
#   docker build -f tools/Dockerfile -t statement-parser tools
#   docker run --rm -p 8787:8787 -e PARSER_TOKEN=choose-a-secret statement-parser
#
# The build context is tools/, so the paths below are relative to it.

FROM python:3.12-slim

# Tesseract lets the reader handle scanned statements too. Drop this layer if
# every statement you receive has a text layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements-service.txt ./
RUN pip install --no-cache-dir -r requirements-service.txt
COPY parser_service.py ./
COPY statement_audit ./statement_audit

ENV PYTHONUNBUFFERED=1 \
    PARSER_HOST=0.0.0.0
EXPOSE 8787

CMD ["python", "parser_service.py"]
