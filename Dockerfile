FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY static ./static
COPY downloads ./downloads

ENV PORT=8080
EXPOSE 8080

# один воркер: конфиг хранится в backend/.env, гонок за файл быть не должно
CMD ["sh", "-c", "cd backend && python3 -m uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
