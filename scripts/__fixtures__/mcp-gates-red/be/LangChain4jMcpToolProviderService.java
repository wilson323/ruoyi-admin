package org.ruoyi.mcp.service.core;

/** 自证夹具（D-G04 违规态）：多读 timeout → 位 1。 */
public class LangChain4jMcpToolProviderService {
    public void build(Object configNode) {
        if (configNode.has("command") && configNode.has("args")) {
            configNode.get("command");
            configNode.get("args");
        }
        if (configNode.has("baseUrl")) {
            configNode.get("baseUrl");
        }
        if (configNode.has("timeout")) {
            configNode.get("timeout");
        }
    }
}
