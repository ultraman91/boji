# 动作分析用到的识别模型

这些文件放在网站自己的仓库里，这样国内不开代理也能用。

| 文件 | 来源 | 协议 |
|---|---|---|
| `vision_bundle.mjs`、`wasm/vision_wasm_internal.*`、`wasm/vision_wasm_nosimd_internal.*` | npm 包 `@mediapipe/tasks-vision` 0.10.35（registry.npmjs.org，下载后已核对 sha512：`HOvadwVRE6JC+45nyYhmnywnr5h/J8KZvOeUNVOG9q/0875pZgItznFB9bRTvLc264YSJqiZ1NsIpCStJw/egg==`） | Apache-2.0 |
| `pose_landmarker_full.task` | Google MediaPipe 官方模型（storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/），9,398,198 字节，sha256 `4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad` | Apache-2.0 |

MediaPipe 是 Google 的开源项目：<https://github.com/google-ai-edge/mediapipe>。
