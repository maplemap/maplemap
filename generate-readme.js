import fs from 'fs';
import fetch from 'node-fetch';

const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_TOKEN = process.env.PAT_TOKEN;
const HEADERS = {
	Authorization: `token ${GITHUB_TOKEN}`,
	Accept: 'application/vnd.github.v3+json',
};

const EXCLUDED_REPOS = new Set([
	'uk.javascript.info',
	'form-validator-module',
	'iframe-action-communicator',
]);

const getDateWeeksAgo = (weeks) => {
	const date = new Date();
	date.setDate(date.getDate() - weeks * 7);
	return date;
};

async function fetchRepos() {
	console.log('Using token:', GITHUB_TOKEN);

	const response = await fetch(
		`https://api.github.com/users/${GITHUB_USERNAME}/repos?per_page=100`,
		{ headers: HEADERS }
	);
	console.log(`https://api.github.com/users/${GITHUB_USERNAME}/repos?per_page=100`)
	console.log(response)

	if (!response.ok) {
		console.error('❌ Failed to fetch repositories:', response.statusText);
		return [];
	}

	return await response.json();
}

async function fetchLanguages(repo) {
	if (!repo.languages_url) return null;

	const response = await fetch(repo.languages_url, { headers: HEADERS });

	if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
		console.warn(`⚠️ Failed to fetch languages for ${repo.name}`);
		return null;
	}

	return await response.json();
}

async function fetchCodeFrequency(repo) {
	const url = `https://api.github.com/repos/${GITHUB_USERNAME}/${repo.name}/stats/code_frequency`;

	for (let attempt = 1; attempt <= 2; attempt++) {
		const response = await fetch(url, { headers: HEADERS });

		if (response.status === 202) {
			console.warn(`⚠️ GitHub is still processing data for ${repo.name}. Retrying in 5 seconds...`);
			await new Promise((res) => setTimeout(res, 5000));
			continue;
		}

		if (!response.ok) {
			console.warn(`⚠️ Failed to fetch code frequency for ${repo.name} (HTTP ${response.status})`);
			return null;
		}

		try {
			const data = await response.json();
			if (!Array.isArray(data) || data.length === 0) {
				console.warn(`⚠️ Code frequency data for ${repo.name} is empty or not available.`);
				return null;
			}
			return data;
		} catch (error) {
			console.error(`❌ Error parsing JSON for ${repo.name}:`, error);
			return null;
		}
	}

	console.warn(`⚠️ Failed to fetch code frequency for ${repo.name} after 2 attempts.`);
	return null;
}

async function getRepoStats() {
	const repos = await fetchRepos();
	const languageStats = {};
	let recentUpdates = [];

	for (const repo of repos) {
		if (EXCLUDED_REPOS.has(repo.name)) continue;

		const languages = await fetchLanguages(repo);
		const codeFrequency = await fetchCodeFrequency(repo);

		if (!languages) continue;

		for (const [lang, bytes] of Object.entries(languages)) {
			languageStats[lang] = (languageStats[lang] || 0) + bytes;
		}

		let repoAdditions = 0;
		let repoDeletions = 0;

		if (Array.isArray(codeFrequency) && codeFrequency.length > 0) {
			codeFrequency.forEach(([timestamp, additions, deletions]) => {
				const commitDate = new Date(timestamp * 1000);
				if (commitDate >= getDateWeeksAgo(6)) {
					repoAdditions += additions;
					repoDeletions += Math.abs(deletions);
				}
			});
		}

		if (repoAdditions > 0 || repoDeletions > 0) {
			recentUpdates.push({
				name: repo.name,
				updatedAt: repo.pushed_at,
				additions: repoAdditions,
				deletions: repoDeletions,
			});
		}
	}

	const totalBytes = Object.values(languageStats).reduce((a, b) => a + b, 0);
	const sortedLanguages = Object.entries(languageStats)
		.sort((a, b) => b[1] - a[1])
		.map(([language, bytes]) => ({
			language,
			percentage: ((bytes / totalBytes) * 100).toFixed(2),
		}));

	recentUpdates.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

	return { sortedLanguages, recentUpdates };
}

async function generateReadme() {
	const { sortedLanguages, recentUpdates } = await getRepoStats();

	let readmeContent = `**GitHub Statistics**\n\n\`\`\`\n`;

	const langLines = sortedLanguages.map(({ language, percentage }) => {
		const barLength = Math.round((percentage / 100) * 20);
		const bar = '█'.repeat(barLength).padEnd(20, '░');
		return `${language.padEnd(12)} ${bar}  ${percentage}%`;
	});

	const updateLines = recentUpdates.map(({ name, updatedAt, additions, deletions }) => {
		return `${name.padEnd(20)} Date: ${new Date(updatedAt).toDateString()}, Lines of Code: +${additions} 📉 -${deletions}`;
	});

	const maxLength = Math.max(langLines.length, updateLines.length);
	for (let i = 0; i < maxLength; i++) {
		const lang = langLines[i] || ''.padEnd(40);
		const update = updateLines[i] || '';
		readmeContent += `${lang}${''.padEnd(20)}${update}\n`;
	}

	readmeContent += `\`\`\`\n`;

	fs.writeFileSync('README.md', readmeContent);
	console.log('✅ README.md updated successfully!');
}

generateReadme().catch(console.error);
