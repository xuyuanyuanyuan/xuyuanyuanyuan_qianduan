# Table regression

The suite uses `unittest`, real SQLite/DuckDB databases and synthetic CSV/XLSX
files. Each test patches only the four storage paths into its own temporary
directory and restores them even on failure. No RAG/model server, API keys,
production uploads or default databases are needed.

## Run locally

From the repository root, using an activated Python 3.12 virtual environment:

```sh
python -m pip install -r rag-service/requirements-table-tests.txt
python rag-service/verify_table_pipeline.py
# The same standalone entry point, exposed through package.json:
npm run test:tables
# Discovery / individual test modules:
python -m unittest discover -s rag-service/tests -t rag-service -p 'test_table_*.py' -v
cd rag-service
python -m unittest tests.test_table_query -v
```

The script resolves test paths relative to itself, so an absolute invocation
works from any directory. Failures and import errors return exit code 1; no tests
is an error. Assertions remain active under `python -O` because the suite uses
unittest assertions, not bare `assert` statements.

## Test organization

| Module | Contracts |
| --- | --- |
| `tests/test_table_ingestor.py` | UTF-8/GBK CSV, XLSX with multiple Sheets, SQL/source column mapping, exact AVG/GROUP BY results, all-empty/constant column profiles, project and description roundtrip, header-only CSV, unsupported/missing/empty/corrupt files, failed-Sheet rollback, all-Sheet deletion |
| `tests/test_table_registry.py` | Persistence/reopen, selected/duplicate/unknown/mixed/empty dataset filters, malformed filters, parameterized lookup/delete |
| `tests/test_table_query.py` | Case/whitespace/BOM, nested/inline/trailing comments, model wrappers, literal semicolons/keywords, mutations/non-SELECT and multiple statements rejected, CTE/nested queries, argument and explicit/nested LIMIT/ALL/OFFSET, malformed SQL/limit, JSON nulls, scope enforcement across JOIN/UNION/scalar/EXISTS/CTE references and CTE shadowing, external/system/unregistered sources, identifier injection |
| `tests/test_table_http.py` | Upload→list→detail→query→preview→delete, dataset scope propagation, cross-dataset Sheet mismatch, malformed JSON/sql/limit producing 400, failed-upload cleanup |
| `tests/test_table_entrypoint.py` | Failure/success results, empty-suite rejection, actual process exit status under `-O` from an arbitrary directory |

## Query contracts

- One parsed read-only SELECT/WITH statement. DuckDB's pinned parser and SQL
  serialization API distinguish syntax from string literals/quoted identifiers.
  Full fenced SQL, a single backtick wrapper and `SQL:` remain accepted; content
  outside a fence is rejected. Nested comments and trailing statement delimiters
  are handled by canonicalization.
- The outer result is bounded to `max(1, min(requested_limit, 1000))`, even if the
  SQL contains a larger LIMIT, LIMIT ALL or OFFSET. Inner LIMIT semantics remain
  intact; SQL `LIMIT 0` still returns zero rows. Integer strings are accepted;
  booleans, floats, nulls and malformed values are rejected.
- `dataset_ids=None`/omitted means all **registered** datasets. An explicit `[]`
  means no warehouse tables; unknown IDs never expand to all datasets. References
  outside the selected set are rejected, including references in nested queries.
  Only unqualified/main-schema managed tables are supported; arbitrary catalog
  qualifiers and table functions are rejected, and external access is disabled.
- This is a dataset query boundary, not user/tenant authentication. A deployment
  that adds account ACLs must derive/intersect this set on the trusted server;
  client-provided IDs alone do not establish user permissions.
- The Agent always submits the dataset IDs from the schemas actually loaded,
  including its fallback query. A non-empty selection with no matches returns
  the no-dataset response instead of querying all datasets. For compatibility,
  the Agent's optional empty UI selection continues to mean no specific filter.

## GitHub Actions

`.github/workflows/table-regression.yml` runs on pushes to main, pull requests to
main and manual dispatch, with `contents: read`, no secrets and 10-minute job
limits. There are no path filters, so required checks can run on every PR.

| Check | Steps |
| --- | --- |
| `Table regression (Python 3.12)` | Install the shared table pins and minimal HTTP test dependencies; `pip check`; discover the complete suite; run the standalone script with `-O` |
| `Frontend typecheck and build (Node 22)` | `npm ci` using the committed lockfile; `npm run typecheck`; `npm run build` |

These checks become merge gates when repository administrators mark them as
required in the main branch protection/ruleset. Adding a workflow alone does
not enable branch protection. `npm run lint` is excluded: package.json currently
advertises ESLint without installing/configuring it. RAG/model/GPU tests are
outside this offline table regression.

## Validation recorded for this change

- Python 3.12.14: all 33 test methods pass, including parameterized subcases;
  both unittest discovery and the standalone `python -O` entry point pass.
- An absolute standalone invocation from a separate working directory passes;
  configured warehouse/registry sentinel files stay byte-for-byte unchanged and
  configured data/upload directories are not created.
- `pip check`, Python compilation and `git diff --check` pass.
- Node 22.23.3: TypeScript check and the production Next.js build pass.
- Workflow YAML structure was parsed and checked locally. GitHub-hosted job
  execution is a separate result and should be read from the PR's checks.
