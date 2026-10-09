import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from config import settings
from tables.routes import create_table_router
from tests.table_support import TableTestCase


class TableHttpTests(TableTestCase):
    def setUp(self):
        super().setUp()
        app = FastAPI()
        app.include_router(create_table_router(self.registry, self.ingestor, self.engine))
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def upload(self, name="a.csv", content="桩号,深度,空列\nA,10,\nB,20,\n"):
        response = self.client.post("/tables/upload", files={"file": (name, content.encode("utf-8"))},
                                    data={"project_name": "接口测试工程"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["dataset"]

    def test_upload_list_detail_query_preview_and_delete(self):
        dataset = self.upload()
        key = dataset["dataset_id"]
        sheet = dataset["sheets"][0]
        self.assertEqual(self.client.get("/tables/datasets").json()["datasets"][0]["project_name"], "接口测试工程")
        self.assertEqual(self.client.get(f"/tables/datasets/{key}").json()["dataset"]["total_rows"], 2)
        query = self.client.post("/tables/query", json={"sql": f'SELECT * FROM "{sheet["table_name"]}"', "dataset_ids": [key], "limit": 1})
        self.assertEqual(query.status_code, 200, query.text)
        self.assertEqual(query.json()["row_count"], 1)
        self.assertIsNone(query.json()["rows"][0]["col_3"])
        response = self.client.post("/tables/preview", json={"dataset_id": key, "sheet_id": sheet["sheet_id"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["row_count"], 2)
        self.assertEqual(self.client.delete(f"/tables/datasets/{key}").status_code, 200)
        self.assertEqual(self.client.get(f"/tables/datasets/{key}").status_code, 404)
        self.assertEqual(self.client.delete(f"/tables/datasets/{key}").status_code, 404)

    def test_query_scope_and_preview_sheet_dataset_mismatch(self):
        a, b = self.upload(), self.upload("b.csv")
        sheet = b["sheets"][0]
        sql = f'SELECT * FROM "{sheet["table_name"]}"'
        for ids in [[a["dataset_id"]], [], ["missing"]]:
            with self.subTest(ids=ids):
                response = self.client.post("/tables/query", json={"sql": sql, "dataset_ids": ids})
                self.assertEqual(response.status_code, 400, response.text)
        response = self.client.post("/tables/preview", json={"dataset_id": a["dataset_id"], "sheet_id": sheet["sheet_id"]})
        self.assertEqual(response.status_code, 404)

    def test_malformed_json_sql_and_limit_return_400(self):
        for body in [None, [], "text", 1, {}, {"sql": 1}, {"sql": "SELECT 1", "limit": None},
                     {"sql": "SELECT 1", "limit": "abc"}, {"sql": "SELECT 1", "limit": 1.5},
                     {"sql": "SELECT 1", "limit": True}, {"sql": "SELECT 1", "dataset_ids": "abc"},
                     {"sql": "SELECT 1; SELECT 2"}, {"sql": "DROP TABLE no"}]:
            with self.subTest(body=body):
                response = self.client.post("/tables/query", content=json.dumps(body), headers={"Content-Type": "application/json"})
                self.assertEqual(response.status_code, 400, response.text)
        for endpoint in ["/tables/query", "/tables/preview"]:
            self.assertEqual(self.client.post(endpoint, content="{bad").status_code, 400)

    def test_preview_invalid_limit_and_ids(self):
        dataset = self.upload()
        sheet = dataset["sheets"][0]
        for body in [{}, {"dataset_id": [], "sheet_id": 1},
                     {"dataset_id": dataset["dataset_id"], "sheet_id": sheet["sheet_id"], "limit": "bad"}]:
            with self.subTest(body=body):
                self.assertEqual(self.client.post("/tables/preview", json=body).status_code, 400)

    def test_failed_upload_cleans_file_and_registry(self):
        for name, content in [("bad.txt", b"hello"), ("empty.csv", b""), ("bad.xlsx", b"broken")]:
            with self.subTest(name=name):
                response = self.client.post("/tables/upload", files={"file": (name, content)})
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(self.registry.count(), 0)
                self.assertEqual(list(settings.table_upload_dir.iterdir()), [])
