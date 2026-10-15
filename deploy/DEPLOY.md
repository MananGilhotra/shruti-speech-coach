# Deploying the hosted demo (Hugging Face Spaces, free CPU tier)

1. Build the dashboard and the Judge Mode pack locally: `make web demos`.
2. Create a new Space (SDK: **Docker**) on huggingface.co.
3. Push this repository's contents to the Space, with `deploy/huggingface/README.md` as the Space's `README.md`
   and `docker/Dockerfile` copied to the repository root as `Dockerfile`:
   ```bash
   git clone https://huggingface.co/spaces/<you>/shruti hf-space
   rsync -a --exclude .git --exclude .venv --exclude web/node_modules --exclude data/renders --exclude data/raw \
         --exclude results/cache ./ hf-space/
   cp deploy/huggingface/README.md hf-space/README.md
   cp docker/Dockerfile hf-space/Dockerfile
   cd hf-space && git add -A && git commit -m "SHRUTI demo" && git push
   ```
4. The image downloads the wav2vec2 model at build time, so the first analysis is fast.
5. Free Spaces sleep when idle: open the demo every morning of the judging window (15–20 Oct 2026).

Check the current free-tier limits (CPU, RAM, sleep policy) on the Hugging Face pricing page when you deploy;
they change over time.
