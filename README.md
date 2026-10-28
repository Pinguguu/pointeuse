# Pointeuse

Suivi des heures travaillées pour une équipe en restauration : pointage de l'arrivée et du départ au quart d'heure, jours off, tableau de bord du mois et de la semaine, historique modifiable, planning de la semaine, export CSV. La pause est comprise dans les horaires : temps travaillé = départ − arrivée.

Chaque personne a son compte (identifiant et mot de passe) et ne voit que ses propres heures. Elles sont enregistrées en ligne et se retrouvent sur tous les appareils. Si le réseau manque, la saisie reste sur le téléphone et part dès que la connexion revient.

Hébergé sur **Cloudflare Workers** (le site et l'API) avec une base **D1** (SQLite). Pas de framework : du HTML, du CSS et du JavaScript simples. Tout tient dans l'offre gratuite de Cloudflare.

## Déployer (environ 10 minutes)

Les libellés du tableau de bord Cloudflare changent de temps en temps ; l'idée reste la même.

### 1. Créer la base D1

1. Dans Cloudflare : **Storage & databases**, **D1 SQL database**, **Create database**.
2. Nom : `pointeuse`.
3. Copiez son **Database ID**.
4. Dans `wrangler.jsonc`, remplacez `COLLER-ICI-L-IDENTIFIANT-DE-LA-BASE-D1` par cet identifiant, puis enregistrez la modification sur GitHub (commit sur la branche `main`).

Les tables (comptes, sessions, heures) se créent toutes seules à la première requête.

### 2. Relier GitHub à Cloudflare

1. **Workers & Pages**, **Create application**, **Import a repository**.
2. Choisissez le dépôt `pointeuse`.
3. Le **nom du Worker doit être exactement `pointeuse`** (c'est le `name` de `wrangler.jsonc`), sinon le déploiement échoue.
4. Commande de build : laissez vide. Si une commande de déploiement est demandée : `npx wrangler deploy`.
5. **Save and Deploy**. Ensuite, chaque modification poussée sur `main` redéploie le site.

### 3. Mettre un code d'invitation (fortement conseillé)

Dans le Worker : **Settings**, **Variables and Secrets**, **Add** :

- Type : **Secret** (pas « Text »)
- Nom : `INVITE_CODE`
- Valeur : le code que vous donnez à vos collègues

Sans ce secret, toute personne qui connaît l'adresse du site peut créer un compte. Pour fermer les inscriptions, changez le code : les comptes existants continuent de fonctionner.

### 4. Partager

Ouvrez `https://pointeuse.<votre-sous-domaine>.workers.dev`, créez votre compte, puis envoyez l'adresse et le code d'invitation à vos collègues.

Sur iPhone : ouvrir l'adresse dans **Safari**, bouton Partager, **Sur l'écran d'accueil**. Sur Android : menu **⋮** de Chrome, **Ajouter à l'écran d'accueil**.

### Variante en ligne de commande

```
npm install
npx wrangler login
npx wrangler d1 create pointeuse     # affiche le database_id à copier dans wrangler.jsonc
npx wrangler secret put INVITE_CODE
npx wrangler deploy
```

## Mot de passe oublié

Il n'y a pas d'envoi d'e-mail : la personne qui gère le site réinitialise le mot de passe à la main.

1. Ouvrez `/outils/reset.html` sur le site.
2. Saisissez l'identifiant et un nouveau mot de passe : la page fabrique une requête SQL. Le mot de passe reste dans votre navigateur, seule son empreinte apparaît.
3. Cloudflare, **D1**, `pointeuse`, onglet **Console** : collez la requête et exécutez-la.
4. Donnez le nouveau mot de passe à la personne, qui peut le changer dans **Réglages**.

La requête ferme aussi ses sessions ouvertes et lève un éventuel blocage après trop d'essais.

## Développement local

```
npm install
echo "INVITE_CODE=resto2026" > .dev.vars     # facultatif, jamais versionné
npm run dev                                  # http://localhost:8787
```

La base D1 locale est créée dans `.wrangler/` (ignoré par git) ; la valeur d'exemple de `database_id` suffit en local.

## Comment les heures sont rangées

Chaque compte a de petits documents JSON dans la table `docs` :

- `m-2026-10` : les jours pointés d'un mois (`{"days": {"2026-10-28": {"in": "10:00", "out": "15:30"}}}`, ou `{"off": true}`, avec une `note` facultative) ;
- `p-2026-10-26` : le planning de la semaine qui commence ce lundi (`start`, `end` ou `off`) ;
- `settings` : la durée hebdomadaire de référence.

Le serveur ne garde que ces champs, au bon format (heures `HH:MM`, notes de 80 caractères au plus).

## Sécurité (résumé)

- Mots de passe : PBKDF2-SHA256, 100 000 itérations, sel aléatoire. Seule l'empreinte est stockée.
- Sessions : jeton aléatoire de 90 jours, seul son hachage est stocké ; cookie `HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS. Changer de mot de passe ferme les autres sessions.
- Limitation des essais : 8 échecs par identifiant et par 15 minutes (30 par adresse IP), 20 créations de compte par heure et par adresse IP.
- Vérification de l'en-tête `Origin` sur les requêtes qui modifient des données.
- Politique de sécurité du contenu (CSP) et autres en-têtes dans `public/_headers`.
- Chaque requête est limitée au compte connecté.

À savoir : la personne qui héberge le site a accès à la base de données, donc aux heures de chacun.

## Fichiers

```
src/index.js               API : comptes, sessions, heures (Workers + D1)
public/index.html          page unique (connexion, pointage, tableau de bord, historique, planning, réglages)
public/app.js              logique du site
public/style.css           styles
public/_headers            en-têtes de sécurité
public/manifest.webmanifest, icônes   ajout à l'écran d'accueil
public/outils/             outil de réinitialisation de mot de passe
wrangler.jsonc             configuration Cloudflare
```
