# Deploying Quorum on Alibaba Cloud (proof-of-deployment)

The hackathon's proof-of-deployment has two parts:

1. **Code-file proof (done):** all four-to-five model calls per council verdict go through [`lib/qwen.ts`](lib/qwen.ts), which targets the Alibaba Cloud DashScope OpenAI-compatible endpoint `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` with a `DASHSCOPE_API_KEY` issued in the Alibaba Cloud console.
2. **Workbench screenshot:** run the app on an Alibaba Cloud instance and screenshot the running resource in the Workbench Overview.

## Quickest path (Simple Application Server or ECS)

```bash
# on a fresh Ubuntu instance with Docker installed:
git clone https://github.com/yanzaaa/quorum && cd quorum
docker build -t quorum .
docker run -d --restart=always -p 3001:3000 -e DASHSCOPE_API_KEY=sk-... quorum
# open port 3001 in the instance's firewall rules, then hit http://<instance-ip>:3001
# (port 3001 so Gatekeeper and Quorum can share one instance)
```

No Docker? `npm ci && npm run build` then keep it alive with pm2: `pm2 start npm --name quorum -- start`.

Then take the screenshot: Alibaba Cloud console → Workbench / instance Overview showing the running instance (and optionally a terminal with the running container) → attach it to the Devpost submission.
