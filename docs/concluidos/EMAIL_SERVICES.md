# 📧 Serviços de Email Gratuitos para TradingBot

## 🏆 Melhor Opção: Resend (Recomendado)

**Por que Resend é melhor:**
- ✅ **100 emails/dia GRÁTIS** (SendGrid só 100/mês)
- ✅ API mais simples e moderna
- ✅ Melhor deliverability
- ✅ Dashboard mais limpo
- ✅ Sem cartão de crédito necessário

### Como Configurar Resend

1. **Criar conta**: https://resend.com/signup
2. **Obter API Key**: Dashboard → API Keys → Create API Key
3. **Adicionar no `.env`**:
```bash
# Trocar SendGrid por Resend
EMAIL_SERVICE=resend
RESEND_API_KEY=re_TrqZ9WQ3_Ec8MEgnbXgfg367eS4NNywnt
EMAIL_FROM=noreply@seudominio.com
```

4. **Instalar biblioteca**:
```powershell
cd services/api-gateway
npm install resend
```

5. **Atualizar código** (services/api-gateway/src/services/email.ts):
```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(to: string, subject: string, html: string) {
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'noreply@resend.dev',
    to,
    subject,
    html,
  });
  
  if (error) throw error;
  return data;
}
```

---

## Outras Opções Gratuitas

### 2. Mailgun
- ✅ **100 emails/dia grátis**
- ✅ Boa documentação
- ⚠️ Requer cartão de crédito

### 3. Brevo (ex-Sendinblue)
- ✅ **300 emails/dia grátis**
- ✅ Inclui SMS também
- ⚠️ Dashboard mais complexo

### 4. Nodemailer + Gmail (Desenvolvimento)
- ✅ Totalmente grátis
- ✅ Bom para teste local
- ❌ Limite de 500 emails/dia
- ❌ Não recomendado para produção

```typescript
// Exemplo Nodemailer + Gmail
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'seu-email@gmail.com',
    pass: 'sua-senha-de-app' // App Password do Gmail
  }
});
```

---

## 📊 Comparação Rápida

| Serviço | Grátis/Dia | Setup | Produção |
|---------|-----------|-------|----------|
| **Resend** | 100 | ⭐⭐⭐⭐⭐ | ✅ |
| SendGrid | 3 | ⭐⭐⭐ | ✅ |
| Mailgun | 100 | ⭐⭐⭐⭐ | ✅ |
| Brevo | 300 | ⭐⭐⭐ | ✅ |
| Gmail | 500 | ⭐⭐⭐⭐⭐ | ❌ |

---

## 🚀 Recomendação

**Para TradingBot**: Use **Resend**
- Perfeito para notificações automáticas
- 100 emails/dia é suficiente para alertas de trading
- API moderna e simples
- Sem necessidade de cartão de crédito

**Para desenvolvimento local**: Use **Nodemailer + Gmail**
- Mais rápido para testar
- Não precisa de API key externa
