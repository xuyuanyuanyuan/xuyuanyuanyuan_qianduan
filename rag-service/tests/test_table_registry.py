from tests.table_support import TableTestCase
from tables import TableRegistry


class RegistryTests(TableTestCase):
    def test_filter_subset_duplicates_unknown_and_empty(self):
        a = self.ingest_csv(name="a.csv")
        b = self.ingest_csv(name="b.csv")
        aid, bid = a["dataset_id"], b["dataset_id"]
        for ids, expected in [(None, {aid, bid}), ([aid], {aid}), ([aid, aid], {aid}),
                              (["missing"], set()), ([aid, "missing"], {aid}), ([], set())]:
            with self.subTest(ids=ids):
                self.assertEqual({x["dataset_id"] for x in self.registry.filter(ids)}, expected)

    def test_invalid_filter_is_rejected(self):
        for ids in ["abc", [None], [1], {"a": 1}, [""]]:
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                self.registry.filter(ids)

    def test_parameterized_lookup_delete_and_reopen(self):
        dataset = self.ingest_csv()
        key = dataset["dataset_id"]
        reopened = TableRegistry(self.registry.db_path)
        self.assertEqual(reopened.get(key)["sheets"], dataset["sheets"])
        self.assertIsNone(reopened.get("' OR 1=1 --"))
        self.assertFalse(reopened.delete("' OR 1=1 --"))
        self.assertEqual(reopened.count(), 1)
        self.assertTrue(reopened.delete(key))
        self.assertFalse(reopened.delete(key))
