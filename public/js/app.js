/**
 * 小票报销Word生成工具 - 前端逻辑
 */

// 全局状态
const state = {
  files: [],           // { id, file, status, result }
  nextId: 1
};

// DOM 元素
const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');
const filesSection = document.getElementById('files-section');
const fileList = document.getElementById('file-list');
const fileCount = document.getElementById('file-count');
const resultsSection = document.getElementById('results-section');
const resultsList = document.getElementById('results-list');
const actionsSection = document.getElementById('actions-section');
const generateBtn = document.getElementById('generate-btn');
const generateHint = document.getElementById('generate-hint');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const apiStatus = document.getElementById('api-status');
const apiStatusText = document.getElementById('api-status-text');

// 初始化
async function init() {
  setupUploadEvents();
  checkApiStatus();
}

// 检查API配置状态
async function checkApiStatus() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    apiStatus.classList.remove('hidden');
    if (data.deepseekConfigured) {
      apiStatus.classList.add('ok');
      apiStatusText.textContent = 'DeepSeek API 已配置';
    } else {
      apiStatus.classList.add('error');
      apiStatusText.textContent = '未配置 DeepSeek API Key，请在 .env 文件中设置';
    }
  } catch (e) {
    apiStatus.classList.remove('hidden');
    apiStatus.classList.add('error');
    apiStatusText.textContent = '无法连接后端服务';
  }
}

// 上传事件
function setupUploadEvents() {
  uploadArea.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = '';
  });

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });
}

// 处理文件选择
function handleFiles(fileList) {
  const pdfFiles = Array.from(fileList).filter(f =>
    f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
  );

  if (pdfFiles.length === 0) {
    alert('请选择PDF文件');
    return;
  }

  pdfFiles.forEach(file => {
    const id = state.nextId++;
    state.files.push({ id, file, status: 'pending', result: null });
  });

  updateFileListUI();
  startRecognition();
}

// 更新文件列表UI
function updateFileListUI() {
  filesSection.classList.remove('hidden');
  fileCount.textContent = `(${state.files.length})`;

  fileList.innerHTML = state.files.map(f => {
    let statusHtml = '';
    if (f.status === 'pending') {
      statusHtml = '<span class="status pending">待识别</span>';
    } else if (f.status === 'processing') {
      statusHtml = '<span class="status pending">识别中...</span>';
    } else if (f.status === 'success') {
      statusHtml = '<span class="status success">已识别</span>';
    } else if (f.status === 'error') {
      statusHtml = '<span class="status error">失败</span>';
    }

    return `
      <div class="file-item" data-id="${f.id}">
        <div class="file-name">
          <span class="file-icon">📄</span>
          <span>${escapeHtml(f.file.name)}</span>
        </div>
        <div class="file-status">
          ${statusHtml}
          <button class="remove-btn" onclick="removeFile(${f.id})" title="移除">×</button>
        </div>
      </div>
    `;
  }).join('');
}

// 移除文件
function removeFile(id) {
  state.files = state.files.filter(f => f.id !== id);
  updateFileListUI();
  updateResultsUI();

  if (state.files.length === 0) {
    filesSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    actionsSection.classList.add('hidden');
  }
}

// 开始识别
async function startRecognition() {
  resultsSection.classList.remove('hidden');
  actionsSection.classList.remove('hidden');
  generateBtn.disabled = true;
  generateHint.textContent = '正在识别中，请稍候...';
  generateHint.classList.remove('hidden');

  updateResultsUI();

  const pendingFiles = state.files.filter(f => f.status === 'pending');

  for (const fileObj of pendingFiles) {
    fileObj.status = 'processing';
    updateFileListUI();
    updateResultCardStatus(fileObj.id, 'processing');

    try {
      const formData = new FormData();
      formData.append('pdf', fileObj.file);

      const res = await fetch('/api/recognize', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || '识别失败');
      }

      fileObj.status = 'success';
      fileObj.result = data.data;
    } catch (err) {
      console.error('识别失败:', err);
      fileObj.status = 'error';
      fileObj.error = err.message;
    }

    updateFileListUI();
    updateResultCard(fileObj);
  }

  // 所有识别完成
  const hasSuccess = state.files.some(f => f.status === 'success');
  generateBtn.disabled = !hasSuccess;
  generateHint.textContent = hasSuccess
    ? '确认信息无误后，点击下方按钮生成Word'
    : '所有文件识别失败，请检查API配置后重试';
}

// 更新结果卡片状态
function updateResultCardStatus(id, status) {
  const card = document.querySelector(`.receipt-card[data-id="${id}"]`);
  if (!card) return;

  const header = card.querySelector('.receipt-header h3');
  if (status === 'processing') {
    header.textContent = `小票 #${getFileIndex(id)} - 识别中...`;
  }
}

// 获取文件序号
function getFileIndex(id) {
  return state.files.findIndex(f => f.id === id) + 1;
}

// 更新结果区域UI
function updateResultsUI() {
  resultsList.innerHTML = state.files.map(f => renderReceiptCard(f)).join('');
}

// 更新单张结果卡片
function updateResultCard(fileObj) {
  const existing = document.querySelector(`.receipt-card[data-id="${fileObj.id}"]`);
  if (existing) {
    existing.outerHTML = renderReceiptCard(fileObj);
  } else {
    updateResultsUI();
  }
}

// 渲染单张发票编辑卡片
function renderReceiptCard(fileObj) {
  const idx = getFileIndex(fileObj.id);
  const data = fileObj.result || { date: '', address: '', totalAmount: '', items: [] };

  let headerText = `小票 #${idx}`;
  if (fileObj.status === 'processing') headerText += ' - 识别中...';
  if (fileObj.status === 'error') headerText += ' - 识别失败';

  const itemsHtml = (data.items || []).map((item, i) => `
    <tr data-item-index="${i}">
      <td class="col-num">${i + 1}</td>
      <td class="col-name"><input type="text" value="${escapeHtml(item.name || '')}" placeholder="商品名称" data-field="name"></td>
      <td class="col-price"><input type="text" value="${escapeHtml(item.unitPrice || '')}" placeholder="单价" data-field="unitPrice"></td>
      <td class="col-action"><button class="btn-icon" onclick="removeItem(${fileObj.id}, ${i})" title="删除">🗑</button></td>
    </tr>
  `).join('');

  return `
    <div class="receipt-card" data-id="${fileObj.id}"
         data-date="${escapeHtml(data.date)}"
         data-address="${escapeHtml(data.address)}"
         data-total="${escapeHtml(data.totalAmount)}">
      <div class="receipt-header">
        <h3>${headerText}</h3>
        <span>${escapeHtml(fileObj.file.name)}</span>
      </div>
      <div class="receipt-body">
        <div class="form-row">
          <div class="form-group">
            <label>消费日期</label>
            <input type="text" class="date-input" value="${escapeHtml(data.date)}" placeholder="如：2024-01-15">
          </div>
          <div class="form-group">
            <label>消费门店/地址</label>
            <input type="text" class="address-input" value="${escapeHtml(data.address)}" placeholder="如：XX超市">
          </div>
        </div>

        <div class="items-section">
          <label>商品明细</label>
          <table class="items-table">
            <thead>
              <tr>
                <th class="col-num">序号</th>
                <th class="col-name">商品名称</th>
                <th class="col-price">单价 (¥)</th>
                <th class="col-action"></th>
              </tr>
            </thead>
            <tbody class="items-tbody">
              ${itemsHtml || `<tr class="empty-row"><td colspan="4" style="text-align:center;color:#999;padding:20px;">暂无商品明细</td></tr>`}
            </tbody>
          </table>
          <button class="add-item-btn" onclick="addItem(${fileObj.id})">+ 添加商品</button>
        </div>

        <div class="form-row" style="margin-top:16px;">
          <div class="form-group">
            <label>合计总金额 (¥)</label>
            <input type="text" class="total-input" value="${escapeHtml(data.totalAmount)}" placeholder="0.00">
          </div>
        </div>
      </div>
    </div>
  `;
}

// 添加商品行
function addItem(fileId) {
  const card = document.querySelector(`.receipt-card[data-id="${fileId}"]`);
  const tbody = card.querySelector('.items-tbody');

  // 移除空行提示
  const emptyRow = tbody.querySelector('.empty-row');
  if (emptyRow) emptyRow.remove();

  const rowCount = tbody.querySelectorAll('tr[data-item-index]').length;

  const tr = document.createElement('tr');
  tr.setAttribute('data-item-index', rowCount);
  tr.innerHTML = `
    <td class="col-num">${rowCount + 1}</td>
    <td class="col-name"><input type="text" value="" placeholder="商品名称" data-field="name"></td>
    <td class="col-price"><input type="text" value="" placeholder="单价" data-field="unitPrice"></td>
    <td class="col-action"><button class="btn-icon" onclick="removeItem(${fileId}, ${rowCount})" title="删除">🗑</button></td>
  `;
  tbody.appendChild(tr);
}

// 删除商品行
function removeItem(fileId, itemIndex) {
  const card = document.querySelector(`.receipt-card[data-id="${fileId}"]`);
  const tbody = card.querySelector('.items-tbody');
  const rows = tbody.querySelectorAll('tr[data-item-index]');

  if (rows[itemIndex]) {
    rows[itemIndex].remove();
  }

  // 重新编号
  const remaining = tbody.querySelectorAll('tr[data-item-index]');
  remaining.forEach((row, idx) => {
    row.setAttribute('data-item-index', idx);
    row.querySelector('.col-num').textContent = idx + 1;
    const btn = row.querySelector('.btn-icon');
    btn.setAttribute('onclick', `removeItem(${fileId}, ${idx})`);
  });

  if (remaining.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4" style="text-align:center;color:#999;padding:20px;">暂无商品明细</td></tr>`;
  }
}

// 从UI收集所有发票数据
function collectInvoiceData() {
  const cards = document.querySelectorAll('.receipt-card');
  const invoices = [];

  cards.forEach(card => {
    const id = parseInt(card.dataset.id);
    const fileObj = state.files.find(f => f.id === id);
    if (!fileObj || fileObj.status !== 'success') return;

    const date = card.querySelector('.date-input').value.trim();
    const address = card.querySelector('.address-input').value.trim();
    const totalAmount = card.querySelector('.total-input').value.trim();

    const items = [];
    const rows = card.querySelectorAll('.items-tbody tr[data-item-index]');
    rows.forEach(row => {
      const name = row.querySelector('[data-field="name"]').value.trim();
      const unitPrice = row.querySelector('[data-field="unitPrice"]').value.trim();
      if (name || unitPrice) {
        items.push({
          name,
          unitPrice,
          quantity: '1',
          subtotal: unitPrice
        });
      }
    });

    invoices.push({ date, address, totalAmount, items });
  });

  return invoices;
}

// 生成Word
generateBtn.addEventListener('click', async () => {
  const invoices = collectInvoiceData();

  if (invoices.length === 0) {
    alert('没有可生成的发票数据');
    return;
  }

  showLoading('正在生成Word文档...');

  try {
    const res = await fetch('/api/generate-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoices })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '生成Word失败');
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '报销说明.docx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    generateHint.textContent = 'Word已生成并下载';
  } catch (err) {
    console.error('生成失败:', err);
    alert('生成Word失败: ' + err.message);
  } finally {
    hideLoading();
  }
});

// 加载状态
function showLoading(text) {
  loadingText.textContent = text || '正在处理...';
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

// HTML转义
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 启动
init();
