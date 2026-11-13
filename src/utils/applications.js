// Application forms + submissions (Appy-style), stored in MySQL.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('./database');

function parseQuestions(raw) {
  return String(raw || '').split('\n').map((q) => q.trim()).filter(Boolean).slice(0, 5);
}

async function getForm(formId, guildId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM application_forms WHERE id = ? AND guild_id = ?', [formId, guildId]);
  const form = rows?.[0];
  if (form) { try { form.questions = JSON.parse(form.questions); } catch { form.questions = []; } }
  return form || null;
}

async function listForms(guildId, openOnly = false) {
  if (!db.isEnabled()) return [];
  const rows = await db.query(
    `SELECT f.*, (SELECT COUNT(*) FROM applications a WHERE a.form_id = f.id AND a.status = 'pending') AS pending_count,
            (SELECT COUNT(*) FROM applications a WHERE a.form_id = f.id) AS total_count
     FROM application_forms f WHERE f.guild_id = ? ${openOnly ? 'AND f.is_open = 1' : ''} ORDER BY f.id`,
    [guildId]) || [];
  return rows.map((f) => { try { f.questions = JSON.parse(f.questions); } catch { f.questions = []; } return f; });
}

async function createForm({ guildId, name, description, questions, roleToGrant, reviewChannelId, createdBy }) {
  const res = await db.query(
    'INSERT INTO application_forms (guild_id, name, description, questions, role_to_grant, review_channel_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [guildId, name, description || null, JSON.stringify(questions), roleToGrant || null, reviewChannelId, createdBy],
  );
  return res.insertId;
}

async function setFormOpen(formId, guildId, open) {
  if (!db.isEnabled()) return false;
  await db.query('UPDATE application_forms SET is_open = ? WHERE id = ? AND guild_id = ?', [open ? 1 : 0, formId, guildId]);
  return true;
}

async function getApplication(appId, guildId) {
  if (!db.isEnabled()) return null;
  const rows = await db.query('SELECT * FROM applications WHERE id = ? AND guild_id = ?', [appId, guildId]);
  const app = rows?.[0];
  if (app) { try { app.answers = JSON.parse(app.answers); } catch { app.answers = []; } }
  return app || null;
}

async function submitApplication(form, userId, answers) {
  const res = await db.query(
    'INSERT INTO applications (form_id, guild_id, user_id, answers) VALUES (?, ?, ?, ?)',
    [form.id, form.guild_id, userId, JSON.stringify(answers)],
  );
  return res.insertId;
}

function reviewEmbed(form, app, applicantTag) {
  const fields = form.questions.map((q, i) => ({
    name: q.length > 256 ? q.slice(0, 253) + '…' : q,
    value: (app.answers[i] || '(no answer)').slice(0, 1024) || '(no answer)',
  }));
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📝 New application — ${form.name}`)
    .setDescription(`**Applicant:** <@${app.user_id}> (${applicantTag})\n**Application #${app.id}** · submitted <t:${Math.floor(new Date(app.created_at).getTime() / 1000)}:R>`)
    .addFields(fields)
    .setTimestamp();
}

function reviewRow(appId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`app_accept:${appId}`).setLabel('Accept').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId(`app_deny:${appId}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setEmoji('❌'),
  );
}

function isReviewer(member, settings) {
  if (!member) return false;
  if (member.permissions?.has('Administrator')) return true;
  if (settings?.applicationReviewerRoleId && member.roles?.cache?.has(settings.applicationReviewerRoleId)) return true;
  return false;
}

// Review an application: update DB, grant the form's role on accept, DM the
// applicant. Returns { ok, error? }.
async function reviewApplication(guild, form, app, decision, reviewer, note) {
  if (app.status !== 'pending') return { ok: false, error: `This application was already ${app.status}.` };
  await db.query("UPDATE applications SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = NOW() WHERE id = ?",
    [decision, reviewer.id, note || null, app.id]);
  const applicant = await guild.members.fetch(app.user_id).catch(() => null);
  if (decision === 'accepted' && form.role_to_grant && applicant) {
    await applicant.roles.add(form.role_to_grant).catch(() => {});
  }
  if (applicant) {
    const msg = decision === 'accepted'
      ? `✅ Your application for **${form.name}** was **accepted**!${form.role_to_grant ? ' Your role has been granted.' : ''}${note ? `\nNote from staff: ${note}` : ''}`
      : `❌ Your application for **${form.name}** was **denied**.${note ? `\nReason: ${note}` : ''}`;
    await applicant.send(msg).catch(() => {});
  }
  return { ok: true };
}

module.exports = { parseQuestions, getForm, listForms, createForm, setFormOpen, getApplication, submitApplication, reviewEmbed, reviewRow, isReviewer, reviewApplication };
