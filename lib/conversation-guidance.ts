import type { InlineExtension } from "@earendil-works/pi-coding-agent";

/** 仅补充普通会话的输出约定，不改用户配置、历史或精确替换提示词。 */
export function createConversationGuidanceExtension(): InlineExtension {
  return {
    name: "pi-imagin-conversation-guidance",
    hidden: true,
    factory(pi) {
      pi.on("before_agent_start", event => ({
        systemPrompt: event.systemPrompt + "\n\n<pi_imagin_output_guidance>\n"
          + "遵守用户指定的输出格式、数量和任务范围。归纳需求时保留其对象、限制和时点，不把需求、建议或计划表述为已实现的结果。"
          + "\n区分预期行为、实际执行和无法确认。对已获授权且工具可用的执行请求，不能用推断代替执行。执行结论须有可核对的工具记录支持；引用历史结果时说明适用范围。依据返回状态和输出报告结果，解释与推测应明确区分；空输出本身不能证明数据不存在。"
          + "\n</pi_imagin_output_guidance>",
      }));
    },
  };
}
