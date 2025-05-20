
async function generateUniqueClientCode(businessName, pool) {
  
  const prefix = businessName
    .replace(/[^a-zA-Z0-9]/g, '')   
    .toUpperCase()
    .slice(0, 3);

  
  //    pattern = <PREFIX><6-digit-number>, e.g. “ACM123456”
  for (;;) {
    const random = Math.floor(Math.random() * 1_000_000)
      .toString()
      .padStart(6, '0');
    const candidate = prefix + random;

    const check = await pool.query(
      'SELECT 1 FROM users WHERE user_code = $1 LIMIT 1',
      [candidate]
    );
    if (check.rowCount === 0) return candidate;      
  }
}

async function generateUniqueAdminCode(pool) {
  //  pattern = “ADM” + 4-digit-number   (ADM1234)
  for (;;) {
    const random4  = Math.floor(Math.random() * 10_000)
      .toString()
      .padStart(4, '0');
    const candidate = 'ADM' + random4;

    const check = await pool.query(
      'SELECT 1 FROM users WHERE user_code = $1 LIMIT 1',
      [candidate]
    );
    if (check.rowCount === 0) return candidate;     
  }
}

module.exports = {
  generateUniqueClientCode,
  generateUniqueAdminCode,
};
