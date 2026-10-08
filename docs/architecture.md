# Architecture and verification boundaries

```mermaid
flowchart LR
  A[Workflow requests verification] --> B[Authenticated read-only Worker]
  B --> C[Read Contact relationships]
  B --> D[Read Opportunity relationships]
  C --> E[Resolve matching Property]
  D --> E
  E --> F[Fetch Property identity key]
  F --> G{Exact identity and relationships?}
  G -->|Yes| H[VERIFIED]
  G -->|No, error or ambiguity| I[FAILED]
  I --> J[Human review]
```

The Worker only sends GET requests to the CRM. A verified response is a decision signal, **not** a CRM mutation or proof of production deployment. Network failures, incomplete pagination, mismatched records, malformed responses and conflicting relationships must fail closed.

## Evidence boundary
The repository documents 41 passing unit tests. Live end-to-end certification of this sanitized portfolio version is not claimed.
