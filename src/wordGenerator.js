const fs = require('fs');
const PizZip = require('pizzip');

/**
 * 设置表格行中指定单元格的文本内容
 * 会清空单元格中所有现有文本，只保留一个 <w:t> 节点
 */
function setCellText(rowXml, cellIndex, newText) {
  const cellRegex = /<w:tc\b[\s\S]*?<\/w:tc>/g;
  const cells = [...rowXml.matchAll(cellRegex)];
  if (!cells[cellIndex]) return rowXml;

  let cellXml = cells[cellIndex][0];

  // 统计该单元格中有多少个 <w:t> 节点
  const textMatches = [...cellXml.matchAll(/<w:t(\s+xml:space="preserve")?\s*>[\s\S]*?<\/w:t>/g)];

  if (textMatches.length === 0) {
    // 没有文本节点
    const rMatch = cellXml.match(/(<w:r\b[^>]*>)/);
    if (rMatch) {
      cellXml = cellXml.replace(rMatch[1], `${rMatch[1]}<w:t>${escapeXml(newText)}</w:t>`);
    } else {
      // 连 <w:r> 都没有（空白单元格）
      // 处理正常闭合标签 <w:p>...</w:p>
      if (cellXml.includes('</w:p>')) {
        cellXml = cellXml.replace(/<\/w:p>/, `<w:r><w:t>${escapeXml(newText)}</w:t></w:r></w:p>`);
      } else {
        // 处理自闭合标签 <w:p ... />
        cellXml = cellXml.replace(/<w:p\b([^>]*)\/>/, `<w:p$1><w:r><w:t>${escapeXml(newText)}</w:t></w:r></w:p>`);
      }
    }
  } else if (textMatches.length === 1) {
    // 只有一个，直接替换
    cellXml = cellXml.replace(textMatches[0][0], `<w:t>${escapeXml(newText)}</w:t>`);
  } else {
    // 有多个 <w:t>（如标题行"购物小票"和" #1"分开）
    // 策略：保留第一个 <w:r> 中的 <w:t>，删除其余 <w:r> 节点
    let first = true;
    cellXml = cellXml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (rMatch) => {
      if (first) {
        first = false;
        // 替换这个 <w:r> 中的 <w:t> 为我们想要的文本
        return rMatch.replace(/<w:t(\s+xml:space="preserve")?\s*>[\s\S]*?<\/w:t>/, `<w:t>${escapeXml(newText)}</w:t>`);
      }
      // 删除后续的 <w:r>
      return '';
    });
  }

  return rowXml.replace(cells[cellIndex][0], cellXml);
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 从模板中提取单组小票的表格XML（信息表 + 明细表）
 */
function extractReceiptGroup() {
  const content = fs.readFileSync('./invoice_template.docx');
  const zip = new PizZip(content);
  const xml = zip.files['word/document.xml'].asText();

  const bodyMatch = xml.match(/(<w:body>)([\s\S]*?)(<\/w:body>)/);
  const bodyContent = bodyMatch[2];

  // 在bodyContent中匹配所有表格
  const tableRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
  const tables = [...bodyContent.matchAll(tableRegex)].map(m => m[0]);

  // 第一组：信息表（索引0）+ 明细表（索引1）
  const infoTable = tables[0];
  const itemTable = tables[1];

  const infoRows = [...infoTable.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map(m => m[0]);
  const itemRows = [...itemTable.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map(m => m[0]);

  // 提取表格前缀和后缀（tblPr、tblGrid 等）
  const infoFirstRowIdx = infoTable.indexOf(infoRows[0]);
  const infoLastRowIdx = infoTable.indexOf(infoRows[infoRows.length - 1]);
  const infoPrefix = infoTable.substring(0, infoFirstRowIdx);
  const infoSuffix = infoTable.substring(infoLastRowIdx + infoRows[infoRows.length - 1].length);

  const itemFirstRowIdx = itemTable.indexOf(itemRows[0]);
  const itemLastRowIdx = itemTable.indexOf(itemRows[itemRows.length - 1]);
  const itemPrefix = itemTable.substring(0, itemFirstRowIdx);
  const itemSuffix = itemTable.substring(itemLastRowIdx + itemRows[itemRows.length - 1].length);

  return {
    bodyPrefix: bodyMatch[1],
    bodySuffix: bodyMatch[3],
    infoRows,
    itemRows,
    infoPrefix,
    infoSuffix,
    itemPrefix,
    itemSuffix
  };
}

let templateCache = null;
function getTemplate() {
  if (!templateCache) templateCache = extractReceiptGroup();
  return templateCache;
}

/**
 * 生成填充好的信息表XML
 */
function buildInfoTable(infoRows, receiptNumber, data) {
  const { infoPrefix, infoSuffix } = getTemplate();
  let tableXml = infoPrefix;

  // 行0: 标题
  let titleRow = setCellText(infoRows[0], 0, `购物小票 #${receiptNumber}`);
  tableXml += titleRow;

  // 行1: 地址（第2个单元格是值）
  let addrRow = setCellText(infoRows[1], 1, data.address || '');
  tableXml += addrRow;

  // 行2: 日期
  let dateRow = setCellText(infoRows[2], 1, data.date || '');
  tableXml += dateRow;

  // 行3: 合计金额
  let totalRow = setCellText(infoRows[3], 1, data.totalAmount || '');
  tableXml += totalRow;

  tableXml += infoSuffix;
  return tableXml;
}

/**
 * 生成填充好的明细表XML
 */
function buildItemTable(itemRows, items) {
  const { itemPrefix, itemSuffix } = getTemplate();
  let tableXml = itemPrefix;

  // 行0: 表头
  tableXml += itemRows[0];

  // 数据行模板（使用第1行作为模板）
  const dataRowTemplate = itemRows[1];
  const validItems = (items || []).filter(it => it.name || it.unitPrice);

  if (validItems.length === 0) {
    // 没有商品时保留空白行
    for (let i = 1; i < itemRows.length; i++) {
      tableXml += itemRows[i];
    }
  } else {
    validItems.forEach((item, idx) => {
      let row = setCellText(dataRowTemplate, 0, String(idx + 1));
      row = setCellText(row, 1, item.name || '');
      row = setCellText(row, 2, item.unitPrice || '');
      tableXml += row;
    });
  }

  tableXml += itemSuffix;
  return tableXml;
}

/**
 * 删除不需要的段落（如"小票 #N"、出租车发票等）
 */
function removeUnwantedParagraphs(xmlStr) {
  return xmlStr.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (p) => {
    const texts = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
    // 删除包含"小票 #"或"出租车"的段落
    if (texts.includes('小票') && texts.includes('#')) return '';
    if (texts.includes('出租车')) return '';
    return p;
  });
}

/**
 * 生成Word文档
 * @param {Array} invoices - 发票数据数组
 * @returns {Buffer} Word文件Buffer
 */
function generateWord(invoices) {
  const { bodyPrefix, bodySuffix, infoRows, itemRows } = getTemplate();

  const content = fs.readFileSync('./invoice_template.docx');
  const zip = new PizZip(content);
  let xml = zip.files['word/document.xml'].asText();

  const bodyMatch = xml.match(/(<w:body>)([\s\S]*?)(<\/w:body>)/);
  const bodyContent = bodyMatch[2];

  // 在bodyContent中匹配所有表格
  const tableRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
  const tables = [...bodyContent.matchAll(tableRegex)];

  if (tables.length === 0) throw new Error('模板中没有找到表格');

  // 保留第一个表格之前的所有内容，但删除"小票 #N"等多余段落
  let beforeFirstTable = bodyContent.substring(0, tables[0].index);
  beforeFirstTable = removeUnwantedParagraphs(beforeFirstTable);

  // 保留最后一个表格之后的所有内容，删除出租车相关段落
  const lastTable = tables[tables.length - 1];
  let afterLastTable = bodyContent.substring(lastTable.index + lastTable[0].length);
  afterLastTable = removeUnwantedParagraphs(afterLastTable);

  // 构建新的body内容
  let newBodyContent = beforeFirstTable;

  const validInvoices = (invoices || []).filter(inv => inv);
  validInvoices.forEach((invoice, idx) => {
    if (idx > 0) {
      // 在不同发票组之间添加间距段落
      newBodyContent += '<w:p><w:pPr><w:spacing w:before="200" w:after="200"/></w:pPr></w:p>';
    }
    newBodyContent += buildInfoTable(infoRows, idx + 1, invoice);
    newBodyContent += buildItemTable(itemRows, invoice.items);
  });

  newBodyContent += afterLastTable;

  const newXml = xml.replace(bodyMatch[0], bodyPrefix + newBodyContent + bodySuffix);

  zip.file('word/document.xml', newXml);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { generateWord };
