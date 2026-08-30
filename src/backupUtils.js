/**
 * El Pachax - Local Backup & Restore Utilities
 */

export function validateAndNormalizeBackup(rawContent) {
  try {
    let data;
    if (typeof rawContent === 'string') {
      try {
        data = JSON.parse(rawContent);
      } catch (err) {
        return {
          success: false,
          error: 'الملف المحدد ليس بصيغة JSON صالحة أو أنه تالف.'
        };
      }
    } else if (typeof rawContent === 'object' && rawContent !== null) {
      data = rawContent;
    } else {
      return {
        success: false,
        error: 'محتوى النسخة الاحتياطية غير صالح.'
      };
    }

    // Determine candidate people array
    let candidatePeople = null;
    let exportedAt = null;

    if (Array.isArray(data)) {
      candidatePeople = data;
    } else if (typeof data === 'object' && data !== null) {
      if (Array.isArray(data.people)) {
        candidatePeople = data.people;
        exportedAt = data.exportedAt || null;
      } else if (Array.isArray(data.data)) {
        candidatePeople = data.data;
        exportedAt = data.exportedAt || null;
      } else if (Array.isArray(data.accounts)) {
        candidatePeople = data.accounts;
        exportedAt = data.exportedAt || null;
      }
    }

    if (!candidatePeople || !Array.isArray(candidatePeople)) {
      return {
        success: false,
        error: 'ملف النسخة الاحتياطية لا يحتوي على قائمة حسابات (people) صالحة.'
      };
    }

    if (candidatePeople.length === 0) {
      return {
        success: false,
        error: 'ملف النسخة الاحتياطية فارغ ولا يحتوي على أي حسابات.'
      };
    }

    let totalTransactions = 0;
    const now = Date.now();

    // Validate and sanitize each person
    const normalizedPeople = candidatePeople.map((p, pIdx) => {
      if (typeof p !== 'object' || p === null) {
        throw new Error(`الحساب رقم ${pIdx + 1} يحتوي على بيانات غير صالحة.`);
      }

      // Check if object resembles a person entry
      const hasRecognizableFields =
        p.id !== undefined ||
        typeof p.name === 'string' ||
        typeof p.phone === 'string' ||
        Array.isArray(p.transactions);

      if (!hasRecognizableFields) {
        throw new Error(`الحساب رقم ${pIdx + 1} لا يحتوي على حقول حساب صالحة.`);
      }

      const pId = p.id !== undefined && p.id !== null ? p.id : now + pIdx;
      const name = String(p.name || '').trim();
      if (!name) {
        throw new Error(`الحساب رقم ${pIdx + 1} لا يحتوي على اسم صالح.`);
      }
      const phone = String(p.phone || '').trim();
      const note = String(p.note || '').trim();
      const category = String(p.category || 'Autres').trim() || 'Autres';
      const company = String(p.company || 'Carnet de Dettes').trim() || 'Carnet de Dettes';

      const rawTxs = Array.isArray(p.transactions) ? p.transactions : [];
      const sanitizedTxs = rawTxs.map((t, tIdx) => {
        if (typeof t !== 'object' || t === null) {
          throw new Error(`معاملة غير صالحة في حساب ${name}.`);
        }

        const amount = Number(t.amount);
        if (Number.isNaN(amount) || amount < 0) {
          throw new Error(`مبلغ غير صالح (${t.amount}) في حساب ${name}.`);
        }

        totalTransactions += 1;

        return {
          id: t.id !== undefined && t.id !== null ? t.id : now + pIdx * 1000 + tIdx,
          type: t.type === 'payment' ? 'payment' : 'credit',
          amount: amount,
          goods: String(t.goods || '').trim(),
          note: String(t.note || '').trim(),
          date: t.date ? String(t.date) : new Date().toISOString().slice(0, 10)
        };
      });

      return {
        id: pId,
        name,
        phone,
        note,
        category,
        company,
        transactions: sanitizedTxs
      };
    });

    return {
      success: true,
      people: normalizedPeople,
      stats: {
        totalAccounts: normalizedPeople.length,
        totalTransactions,
        exportedAt: exportedAt || null
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'حدث خطأ أثناء فحص وتأكيد ملف النسخة الاحتياطية.'
    };
  }
}

export function createSafetyBackup(people) {
  try {
    const safetyPayload = {
      app: 'El Pachax',
      version: 1,
      savedAt: new Date().toISOString(),
      reason: 'Automatic pre-restore safety snapshot',
      people
    };
    localStorage.setItem('el-pachax-safety-backup', JSON.stringify(safetyPayload));
    return true;
  } catch (err) {
    console.warn('Could not write safety backup to localStorage:', err);
    return false;
  }
}
