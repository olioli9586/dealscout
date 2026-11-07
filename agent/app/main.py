from fastapi import FastAPI

app = FastAPI(title="DealScout agent")


@app.get("/health")
def health() -> dict:
    return {"ok": True}
