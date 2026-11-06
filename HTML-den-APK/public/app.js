const form = document.getElementById('projectForm');
const fileInput = document.getElementById('project');
const iconInput = document.getElementById('icon');
const fileName = document.getElementById('fileName');
const iconName = document.getElementById('iconName');
const dropZone = document.getElementById('dropZone');
const submitBtn = document.getElementById('submitBtn');
const jobPanel = document.getElementById('jobPanel');
const downloadBtn = document.getElementById('downloadBtn');
let pollTimer = null;

fileInput.addEventListener('change', () => { fileName.textContent = fileInput.files[0]?.name || 'Henüz dosya seçilmedi'; });
iconInput.addEventListener('change', () => { iconName.textContent = iconInput.files[0]?.name || 'Logo seçilmedi'; });
for (const eventName of ['dragenter', 'dragover']) dropZone.addEventListener(eventName, e => { e.preventDefault(); dropZone.classList.add('drag'); });
for (const eventName of ['dragleave', 'drop']) dropZone.addEventListener(eventName, e => { e.preventDefault(); dropZone.classList.remove('drag'); });
dropZone.addEventListener('drop', e => {
  const file = [...e.dataTransfer.files].find(f => /\.(html?|zip)$/i.test(f.name));
  if (!file) return;
  const transfer = new DataTransfer(); transfer.items.add(file); fileInput.files = transfer.files; fileName.textContent = file.name;
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!fileInput.files.length) return alert('Lütfen HTML veya ZIP dosyası seçin.');
  const data = new FormData(form);
  submitBtn.disabled = true;
  submitBtn.querySelector('span').textContent = 'Proje yükleniyor…';
  downloadBtn.classList.add('hidden');
  try {
    const response = await fetch('/api/projects', { method: 'POST', body: data });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Yükleme başarısız.');
    jobPanel.classList.remove('hidden');
    document.getElementById('jobTitle').textContent = data.get('appName');
    document.getElementById('jobBadge').textContent = 'Sırada';
    document.getElementById('jobMessage').textContent = result.message;
    document.getElementById('progressBar').style.width = '8%';
    document.getElementById('jobMeta').textContent = `İş numarası: ${result.id} · Derleme durumu otomatik güncellenir.`;
    jobPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (pollTimer) clearInterval(pollTimer);
    pollJob(result.id);
    pollTimer = setInterval(() => pollJob(result.id), 5000);
  } catch (err) { alert(err.message); }
  finally { submitBtn.disabled = false; submitBtn.querySelector('span').textContent = 'APK oluştur'; }
});

async function pollJob(id) {
  try {
    const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
    if (!response.ok) return;
    const job = await response.json();
    const labels = { queued: 'Sırada', building: 'Derleniyor', success: 'Tamamlandı', failed: 'Başarısız' };
    document.getElementById('jobBadge').textContent = labels[job.status] || job.status;
    document.getElementById('jobMessage').textContent = job.message;
    document.getElementById('progressBar').style.width = `${job.progress}%`;
    document.getElementById('jobMeta').textContent = `İş numarası: ${job.id} · ${new Date(job.createdAt).toLocaleString('tr-TR')}`;
    if (job.status === 'success') {
      downloadBtn.href = job.outputs.downloadUrl;
      downloadBtn.classList.remove('hidden');
      clearInterval(pollTimer); pollTimer = null;
    }
    if (job.status === 'failed') { clearInterval(pollTimer); pollTimer = null; }
  } catch (_) { /* geçici ağ hatasında ekrandaki durum korunur */ }
}
