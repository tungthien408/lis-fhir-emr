# SPP-75 – Chỉ mục bằng chứng
- Gốc: docs/docs_backend/spp-75/official-evidence/ (final/ gồm A1,B1,A2,B2,A3,B3; rerun-B1/final/B1; functional/F8R-F10R; experiment-manifest.txt). Tổng ≈ 2,5 GiB, **không commit** (final/ trong .gitignore).
- SHA-256 mọi file: docs/docs_backend/spp-75/07-evidence.sha256 (100 file). Kiểm lại: `cd docs/docs_backend/spp-75/official-evidence && sha256sum -c ../07-evidence.sha256`.
- Thống kê: 04-stats.json. Script: scripts/pilot/{run-scenario,run-all,preflight,fault-retry}.sh, test: scripts/pilot/test/test-runner.sh (36 PASS).
- Commit/tag: spp74-experiment-v1 (64e6265), spp75-runner-v3.
- **SINGLE_COPY_RISK**: toàn bộ bằng chứng chỉ có MỘT bản trên máy này; chưa sao lưu. Cần nhóm chọn nơi lưu thứ hai.
