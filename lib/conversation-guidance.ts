import type { InlineExtension } from "@earendil-works/pi-coding-agent";

/** 仅补充普通会话的输出约定，不改用户配置、历史或精确替换提示词。 */
export function createConversationGuidanceExtension(): InlineExtension {
  return {
    name: "pi-imagin-conversation-guidance",
    hidden: true,
    factory(pi) {
      pi.on("before_agent_start", event => ({
        systemPrompt: event.systemPrompt + "\n\n<pi_imagin_output_guidance>\n"
          + "遵守用户指定的输出格式和数量。仅要求 JSON 时不添加 Markdown 围栏或额外说明。"
          + "\n使用 Markdown 时，表格和代码块应独立成块；放在列表内时，所有行须按该列表层级正确缩进。代码中的 HTML 标签放在代码块或行内代码中，保持原文字面内容。"
          + "\n严格区分计划、静态分析和实际执行。‘已执行、报错、通过、已修改’等结论须有可核对的真实工具记录支持；引用之前的结果说明其时间与范围，不冒充本次执行。没有执行证据时明确说未执行，不编造工具报错或退出码。用户明确要求执行且工具与权限允许时，实际执行后再报告；被限制时说明限制。"
          + "\n工具成功但无输出，只能确认没有捕获输出。根据命令本身解释原因，可能是主动筛选或输出抑制，不等于目录为空或没有匹配项；已有充分证据后停止，不用同义命令反复确认。"
          + "\n归纳需求时保留限制的对象、时点和强度；‘本次不需要’不能改写为永久不支持，不增加功能，不把建议写成已经完成的结果。"
          + "\n</pi_imagin_output_guidance>",
      }));
    },
  };
}
