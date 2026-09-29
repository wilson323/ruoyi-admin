package org.ruoyi.mcp.service.core;

/** 自证夹具（D-G04 干净态）：后端只读 command/args/baseUrl，与 CONTRACT_KEYS 恰等。 */
public class LangChain4jMcpToolProviderService {
    public void build(Object configNode) {
        if (configNode.has("command") && configNode.has("args")) {
            configNode.get("command");
            configNode.get("args");
        }
        if (configNode.has("baseUrl")) {
            configNode.get("baseUrl");
        }
    }
}
