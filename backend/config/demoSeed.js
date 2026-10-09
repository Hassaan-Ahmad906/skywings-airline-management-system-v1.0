// Public synthetic-data credentials shared by local and isolated hosted demos.
// Primary hosted accounts are provisioned separately with private passwords.
const emailDomain = 'public-demo.example.com';
const accounts = {
  admin: { email: `demo.admin@${emailDomain}`, password: 'DemoAdmin2026!' },
  user: { email: `demo.user@${emailDomain}`, password: 'DemoUser2026!' },
  crew: { email: `demo.crew@${emailDomain}`, password: 'DemoCrew2026!' }
};

function customerEmail(first, last, index) {
  return index === 0 ? accounts.user.email : `${first}.${last}@${emailDomain}`.toLowerCase();
}

const publishedPasswords = ['DemoPass123!', ...Object.values(accounts).map(account => account.password)];
module.exports = { accounts, emailDomain, customerEmail, publishedPasswords };
