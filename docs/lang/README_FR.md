<div align="center">

[中文](../../README.md) · [English (UK)](README_EN_UK.md) · [English (US)](README_EN_US.md) · **Français** · [Русский](README_RU.md)

<h1>dsh-claude-effort-slider</h1>

**Un curseur d'effort de raisonnement à six crans, dans le style de Claude Code, pour [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).**
Le sixième cran, **Ultracode**, transforme la piste en une bande de pixels lavande qui défile vers la gauche.

[![Licence : MIT](https://img.shields.io/badge/License-MIT-2EA043.svg)](../../LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-Plugin-4C9AFF.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![version](https://img.shields.io/github/package-json/v/youqisibun/dsh-claude-effort-slider?label=version&color=2EA043)](https://github.com/youqisibun/dsh-claude-effort-slider/releases)
[![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-7B68EE.svg)](https://github.com/topics/dsh-plugin)

</div>

---

> [!NOTE]
> **Mentions légales**
>
> Ce projet est un greffon tiers non officiel. Il **n'est ni affilié, ni approuvé, ni sponsorisé par Anthropic ou DeepSeek**, et n'a reçu aucune autorisation de leur part.<br>
> Les noms « Claude », « Claude Code » et « Ultracode » n'apparaissent que pour décrire l'origine de l'inspiration visuelle ; **les marques et droits de propriété intellectuelle associés appartiennent à leurs détenteurs respectifs**.<br>
> Ce projet ne contient aucun code ni aucune ressource officiels — chaque élément d'interface et chaque animation est dessiné à l'exécution par le code de ce dépôt.
>
> Ce document est une traduction de l'[original chinois](../../README.md) ; en cas de divergence, la version chinoise fait foi.

---

![Bouton de modèle et puce Effort indépendante](../../preview/two-buttons.png)

![Texture Ultracode, thème sombre](../../preview/dark-ultracode.png)

![Texture Ultracode, thème clair](../../preview/light-ultracode.png)

![Animation de remplissage de droite à gauche](../../preview/entrance.png)

---

## Fonctionnalités

- **Puce indépendante** : une puce Effort apparaît à droite de la zone de saisie — un clic pour ouvrir, un autre pour fermer. Le bouton de modèle ne sert qu'à choisir le modèle.
- **Curseur à six crans** : `Low / Medium / High / Extra / Max / Ultracode`. Le glissement prévisualise, le relâchement valide.
- **Texture Ultracode** : balayage de droite à gauche (1,6 s), puis une impulsion par ligne qui se déplace vers la gauche. Rouvrir le panneau **ne rejoue pas** l'animation — seul un retour au dernier cran la rejoue.
- **Adaptation clair / sombre** : le panneau et la texture suivent le thème de l'interface — grille de points lavande sur fond sombre, mosaïque lavande sur fond clair.
- **Utilisable au clavier** : `←/→` et `Home/End` changent de cran, `Esc` ferme.
- **Écriture réelle** : chaque cran appelle `directory.select({ reasoningEffort })` de DSH — ce n'est pas un simple changement de texte.
- **Réversible** : désactiver ou désinstaller restaure le contrôle natif. Aucun fichier de l'hôte n'est modifié.

---

## Installation

Prérequis : **DSH ≥ 0.2.1-rc.2**, **Node.js ≥ 22**.

### Depuis GitHub (recommandé)

```bash
dsh plugin --profile web add github:youqisibun/dsh-claude-effort-slider
```

Après l'installation, **quittez complètement DSH puis relancez-le** (fermer la fenêtre ne suffit pas — le processus doit s'arrêter).

### Dans la version bureau (Electron)

`desktop` est un profil réservé à Electron et ne peut pas être installé en ligne de commande. Utilisez le script fourni :

```powershell
.\install.cmd -Profile desktop
# Désinstallation :
.\install.cmd -Profile desktop -Uninstall
```

Le script sauvegarde le `package.json` du profil, ajoute une dépendance `link:`, inscrit le nom du paquet dans `dsh.profile.bundles` et crée le lien `node_modules`.

### Depuis une archive tarball

```bash
dsh plugin --profile web add ./dsh-claude-effort-slider-0.9.4.tgz
```

---

## Utilisation

| Action | Comportement |
|---|---|
| Clic sur la puce | Ouvrir / fermer le panneau |
| Glisser sur la piste | Aperçu en direct ; **validation au relâchement** (évite les écritures répétées de session et les conflits de verrou pendant le glissement) |
| `←/→`, `Home/End` | Changer de cran au clavier |
| Clic droit sur la piste | Graduations, intensité de la texture, réinitialisation |
| Clic à l'extérieur / `Esc` | Fermer |

Les écritures sont sérialisées : un seul `select` est en cours à la fois. Si un autre greffon détient le verrou d'écriture, le greffon réessaie automatiquement et n'annule qu'après 10 secondes, avec un message.

---

## Correspondance des six crans

DSH n'expose que quatre valeurs réelles de `reasoning effort` — **off / low / high / max**. Les six crans sont une correspondance visuelle :

| Cran visuel | Écrit dans DSH | Remarque |
|---|---|---|
| Low | `off` | Raisonnement désactivé |
| Medium | `low` | Intensité faible |
| High | `high` | Intensité élevée |
| Extra | `high` | Subdivision visuelle, identique à High |
| Max | `high` | Subdivision visuelle, identique à High |
| **Ultracode** | `max` | Intensité maximale + texture en pixels |

> Deux des crans Medium / Extra / Max écrivent la même valeur que leur voisin — **c'est une conséquence du fait que DSH n'a que quatre niveaux, pas un bug**. Ultracode correspond réellement à `max` ; le greffon ne modifie pas les prompts et ne lance pas de sous-agents.

---

## Paramètres de la texture Ultracode

- Grille : **6 lignes × 60 colonnes**, cellule de 4,67 px
- Thème sombre : les blocs occupent 72 % de la cellule (≈3,36 px), grille de points lavande
- Thème clair : les blocs occupent 88 % (joint d'environ 12 %), mosaïque lavande sur un dégradé continu gris → violet
- Balayage : **1,6 s**, le front recule de droite à gauche avec une irrégularité de bord de ±2,5 %
- Repos : deux ondes par ligne de **même vitesse de phase**, si bien que la texture ne se déplace que vers la gauche ; longueur d'onde, vitesse et phase sont aléatoires par ligne
- Mouvement : les cellules s'éclairent au passage d'une crête et leur cœur flashe en blanc ; le front d'avance flashe cellule par cellule pendant un glissement ; la « flamme extérieure » à gauche scintille aléatoirement
- Le halo violet grandit avec le front et ne couvre toute la piste qu'une fois remplie
- Les graduations disparaissent automatiquement au dernier cran
- Le panneau et la texture suivent automatiquement le thème de l'interface — aucun réglage manuel

Pour modifier la vitesse, la densité ou la luminosité, voir la référence des paramètres dans [`ANIMATION.md`](../../ANIMATION.md).

---

## Compatibilité

- Vérifié sur **DSH 0.2.1-rc.2** (web + bureau) ; d'autres versions peuvent nécessiter une nouvelle vérification.
- Le greffon dépend de la structure DOM du siège de modèle officiel. Si une refonte officielle le rend méconnaissable, le greffon revient à sa propre puce — les fonctionnalités sont inchangées et l'interface officielle n'est jamais cassée.
- Coexiste avec d'autres greffons qui réécrivent le contrôle de raisonnement officiel ; les deux peuvent être installés.

---

## FAQ

**Rien ne se passe après l'installation ?**
Le bundle client est injecté au démarrage — vous devez **quitter complètement DSH puis le relancer**.

**Impossible d'installer dans la version bureau ?**
Le profil `desktop` n'accepte pas `dsh plugin` ; utilisez `install.cmd -Profile desktop`.

**Revoir l'animation après avoir atteint le maximum ?**
Fermer puis rouvrir le panneau ne la rejoue pas (par conception) ; éloignez le curseur du dernier cran puis ramenez-le pour la rejouer une fois.

**L'interface native n'est pas revenue après la désinstallation ?**
Lancez `install.cmd -Profile desktop -Uninstall` pour une suppression complète, puis redémarrez.

---

## Développement

```bash
npm test          # 38 assertions hors ligne : correspondance des crans / géométrie / texture / réglages / structure du bundle
npm run pack      # génère le paquet dans dist/
```

Aucune étape de compilation : `lib/client.js` est l'artefact livré (`react` / `react-dom` sont fournis par l'hôte).

```
lib/index.js      Moitié hôte : apply vide + contrôle statique de l'artefact client
lib/client.js     Moitié client : pont de la puce, panneau, curseur, texture en pixels, E/S de répertoire
cordis.patch.yml  Monte le paquet dans l'arbre de greffons cordis
```

---

## Licence

MIT
