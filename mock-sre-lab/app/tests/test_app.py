from fastapi.testclient import TestClient

from src.main import create_app


client = TestClient(create_app())


def test_healthz_returns_ok() -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_catalog_endpoint_returns_payload() -> None:
    response = client.get("/api/v1/catalog/demo-sku")
    assert response.status_code == 200
    payload = response.json()
    assert payload["sku"] == "demo-sku"
    assert "price" in payload


def test_fault_activation_endpoint_enables_scenario() -> None:
    response = client.post("/internal/faults/error_burst", json={"enabled": True, "duration_seconds": 30})
    assert response.status_code == 200
    assert "error_burst" in response.json()["active_faults"]


def test_dashboard_summary_returns_expected_shape() -> None:
    client.get("/api/v1/catalog/demo-sku")
    response = client.get("/api/v1/dashboard/summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["service"] == "mock-sre-app"
    assert "totals" in payload
    assert "routes" in payload
    assert "gauges" in payload


def test_dashboard_page_renders() -> None:
    response = client.get("/dashboard")
    assert response.status_code == 200
    assert "Mock SRE Lab" in response.text
