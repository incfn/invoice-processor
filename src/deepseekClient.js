require('dotenv').config();
const axios = require('axios');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

if (!DEEPSEEK_API_KEY) {
  console.warn('警告: 未设置 DEEPSEEK_API_KEY，请在 .env 文件中配置');
}

const SYSTEM_PROMPT = `你是一位报销单据信息提取专家。请从用户提供的小票文本中提取关键信息，严格按JSON格式返回。

要求字段：
- date: 消费日期（格式：YYYY-MM-DD，若无法确定则保留原始文本）
- address: 消费门店/地址
- items: 商品列表，每项包含：
  - name: 商品名称
  - unitPrice: 单价（纯数字，去掉货币符号）
  - quantity: 数量（纯数字）
  - subtotal: 小计（纯数字，去掉货币符号）
- totalAmount: 总金额（纯数字，去掉货币符号）

注意事项：
1. 如果某项信息无法识别，使用空字符串
2. 金额只保留数字和小数点，去掉¥、$等货币符号
3. 数量默认为1，如果文本中有明确数量则使用实际值
4. 必须返回合法的JSON对象，不要添加任何解释文字或markdown代码块标记
5. 如果小票中没有明确的商品明细列表，请根据文本内容尽可能推断或返回空数组
6. 【重要】OCR识别可能存在错字、漏字、乱码，请根据上下文语义、便利店常识和常见品牌进行纠正。常见纠正示例：
   - "厅切" → "厚切"，"可11" → "可乐"，"罗琳" → "罗森"
   - 楼层代码："L62" 根据上下文（如"层"字前）应纠正为 "LG2"；同理 "L61"→"LG1"，"B1"保持不变
   - "茶叶恒" → "茶叶蛋（"；括号常因模糊被错识别为其他字符
   - "怡宝饮用纯净" → "怡宝饮用纯净水"（末尾的"水"字常漏识别）
   - 地址中的数字"6"和字母"G"容易混淆，"8棒" → "8栋"，"西城" → "西藏"
   - 商品名末尾的规格如 "30g"、"40g" 容易被乱码，请根据商品上下文（如零食、串烧）保留合理规格
7. 【出租车发票特殊处理】如果是出租车发票，items可为空数组，totalAmount取"金额"字段，address取"地址"字段
8. 请保持原文原意，仅纠正明显的OCR错字，不要编造不存在的信息`;

async function extractInvoiceInfo(rawText) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('未配置 DEEPSEEK_API_KEY');
  }

  try {
    const response = await axios.post(
      DEEPSEEK_API_URL,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `以下是发票/小票的文本内容，请提取信息并按JSON格式返回：\n\n${rawText}` }
        ],
        temperature: 0.1,
        max_tokens: 2000
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        timeout: 60000
      }
    );

    const content = response.data.choices[0].message.content;

    // 尝试从回复中提取JSON
    let jsonStr = content.trim();

    // 移除markdown代码块标记
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const result = JSON.parse(jsonStr);

    // 确保字段存在
    return {
      date: result.date || '',
      address: result.address || '',
      items: Array.isArray(result.items) ? result.items.map(item => ({
        name: item.name || '',
        unitPrice: String(item.unitPrice || ''),
        quantity: String(item.quantity || '1'),
        subtotal: String(item.subtotal || '')
      })) : [],
      totalAmount: String(result.totalAmount || '')
    };
  } catch (error) {
    console.error('DeepSeek API 调用失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', JSON.stringify(error.response.data));
    }
    throw new Error(`发票信息提取失败: ${error.message}`);
  }
}

module.exports = { extractInvoiceInfo };
