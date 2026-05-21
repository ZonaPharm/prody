# Prody — Self-Hosting Deployment Plan

## Current State (Vercel Hobby)

| Проблем | Причина |
|---------|---------|
| Забива след idle | Cold start + force-dynamic = 5-15s забавяне |
| Таймаут при продажба | Sales/group прави 25+ Supabase заявки, надвишава 10s лимит |
| Backup не работи | Hobby tier блокира cron задачи |
| Node 24.x | Pre-release версия, възможна нестабилност |
| Няма connection pool | Всеки request отваря нови HTTP връзки към Supabase |

## Хибриден вариант (препоръчан)

**Supabase остава managed, само Next.js се мести на VPS.**

Това е най-безопасният подход:
- Базата, auth, storage — без промяна
- Само приложението се мести
- 0 риск за данните

### Стъпка 1: VPS

Ubuntu 24.04 LTS, минимум 2GB RAM, 2 vCPU.

```bash
# Обнови системата
apt update && apt upgrade -y

# Node.js 22 LTS (НЕ 24!)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs nginx certbot python3-certbot-nginx git

# Провери
node -v  # трябва v22.x
npm -v
```

### Стъпка 2: Клониране и билд

```bash
cd /opt
git clone https://github.com/ZonaPharm/prody.git
cd prody
npm ci
cp .env.example .env.local
# Редактирай .env.local с реалните стойности
npm run build
```

### Стъпка 3: PM2 (process manager)

```bash
npm i -g pm2
pm2 start npm --name prody -- start
pm2 save
pm2 startup systemd
```

PM2 държи процеса жив. При crash — автоматичен restart. При reboot на сървъра — автоматичен старт.

### Стъпка 4: Nginx reverse proxy

```nginx
# /etc/nginx/sites-available/prody
server {
    listen 80;
    server_name prody.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;  # За дълги заявки (exports)
    }
}
```

```bash
ln -s /etc/nginx/sites-available/prody /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

### Стъпка 5: SSL (Let's Encrypt)

```bash
certbot --nginx -d prody.example.com
# Автоматично подновяване — certbot сам добавя systemd timer
```

### Стъпка 6: Cron задачи

Вече работят на собствен сървър!

```bash
# /etc/cron.d/prody
# Backup всеки ден в 3:00
0 3 * * * root curl -s https://prody.example.com/api/cron/backup?secret=YOUR_CRON_SECRET >> /var/log/prody-backup.log 2>&1

# Седмичен отчет — петък 18:00
0 18 * * 5 root curl -s https://prody.example.com/api/cron/weekly-report?secret=YOUR_CRON_SECRET >> /var/log/prody-report.log 2>&1
```

### Стъпка 7: Мониторинг

```bash
# PM2 мониторинг
pm2 status
pm2 logs prody
pm2 monit  # интерактивен dashboard

# Дисково пространство за бекъпи
df -h /opt/prody/backups
```

---

## Какво печелим

| Параметър | Vercel Hobby | Собствен сървър |
|-----------|-------------|-----------------|
| Студени стартове | Да (2-5s след idle) | **Не** |
| Timeout | 10s (hard limit) | **Няма** (120s в nginx) |
| Cron задачи | **Блокирани** | **Работят** |
| Node версия | 24.x (pre-release) | **22 LTS** (стабилна) |
| Памет | 1GB | Колкото има сървърът |
| Цена | $0 (но с проблеми) | ~€5/месец (VPS) |
| Супabase | Managed | Managed (без промяна) |

---

## Резюме

1. **Supabase НЕ пипаме** — остава си managed
2. **Next.js местим** на €5 VPS
3. **4 файла** за конфигурация: `.env.local`, `nginx`, `cron`, `pm2`
4. **30 минути** работа
5. **0 риск** за данните
