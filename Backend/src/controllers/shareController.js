import CommunityPost from "../models/CommunityPost.js";
import Team from "../models/Team.js";
import Player from "../models/Player.js";
import { getCommunitySettings } from "../models/CommunitySettings.js";
import { isReservedTestName } from "../utils/publicProjection.js";

function escapeHtml(s) {
  if (!s || typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getFrontendUrl() {
  return process.env.PUBLIC_FRONTEND_URL || "https://cricall.online";
}

function getBackendUrl() {
  return process.env.PUBLIC_BACKEND_URL || process.env.BACKEND_URL || "http://127.0.0.1:5000";
}

function buildShareHtml({ title, description, image, url, redirectUrl }) {
  const safeTitle = escapeHtml(title || "CricAll");
  const safeDesc = escapeHtml(description || "Cricket community");
  const safeImage = escapeHtml(image || "");
  const safeUrl = escapeHtml(url || redirectUrl);
  const safeRedirect = escapeHtml(redirectUrl);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDesc}">
  <meta property="og:image" content="${safeImage}">
  <meta property="og:url" content="${safeUrl}">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDesc}">
  <meta name="twitter:image" content="${safeImage}">
  <meta http-equiv="refresh" content="0; url=${safeRedirect}">
</head>
<body>
  <script>window.location.replace("${safeRedirect}");</script>
</body>
</html>`;
}

function genericPreview(redirectUrl) {
  return buildShareHtml({
    title: "CricAll",
    description: "Cricket community",
    image: "",
    url: redirectUrl,
    redirectUrl,
  });
}

// GET /share/post/:id
export const sharePost = async (req, res) => {
  try {
    const frontendUrl = getFrontendUrl();
    const backendUrl = getBackendUrl();
    const redirectUrl = `${frontendUrl}/community/post/${req.params.id}`;
    
    const settings = await getCommunitySettings();
    const post = await CommunityPost.findById(req.params.id)
      .populate("authorUser", "name")
      .lean();
    
    // Never leak hidden/pending content or unknown
    if (!post || post.isDeleted || post.status !== "published") {
      return res.type("html").send(genericPreview(redirectUrl));
    }
    
    if (isReservedTestName(post.authorUser?.name)) {
      return res.type("html").send(genericPreview(redirectUrl));
    }
    
    if (!settings.communityEnabled) {
      return res.type("html").send(genericPreview(redirectUrl));
    }
    
    let image = "";
    if (post.media && post.media.length > 0 && post.media[0].url) {
      const imgUrl = post.media[0].url;
      if (imgUrl.startsWith("http")) {
        image = imgUrl;
      } else if (imgUrl.startsWith("/uploads/")) {
        image = `${backendUrl}${imgUrl}`;
      } else {
        image = `${backendUrl}${imgUrl}`;
      }
    }
    
    const title = post.title || "Community Post";
    const description = post.body ? post.body.substring(0, 200) : "Check out this post on CricAll";
    
    res.type("html").send(
      buildShareHtml({
        title,
        description,
        image,
        url: redirectUrl,
        redirectUrl,
      })
    );
  } catch (err) {
    const frontendUrl = getFrontendUrl();
    res.type("html").send(genericPreview(`${frontendUrl}/community/post/${req.params.id}`));
  }
};

// GET /share/team/:id
export const shareTeam = async (req, res) => {
  try {
    const frontendUrl = getFrontendUrl();
    const backendUrl = getBackendUrl();
    const redirectUrl = `${frontendUrl}/teams/${req.params.id}`;
    
    const team = await Team.findById(req.params.id).select("name logo isPublic").lean();
    if (!team || isReservedTestName(team.name) || team.isPublic === false) {
      return res.type("html").send(genericPreview(redirectUrl));
    }
    
    let image = "";
    if (team.logo && team.logo.startsWith("/uploads/")) {
      image = `${backendUrl}${team.logo}`;
    } else if (team.logo && team.logo.startsWith("http")) {
      image = team.logo;
    }
    
    res.type("html").send(
      buildShareHtml({
        title: team.name,
        description: `${team.name} on CricAll`,
        image,
        url: redirectUrl,
        redirectUrl,
      })
    );
  } catch (err) {
    const frontendUrl = getFrontendUrl();
    res.type("html").send(genericPreview(`${frontendUrl}/teams/${req.params.id}`));
  }
};

// GET /share/player/:id
export const sharePlayer = async (req, res) => {
  try {
    const frontendUrl = getFrontendUrl();
    const backendUrl = getBackendUrl();
    const redirectUrl = `${frontendUrl}/players/${req.params.id}`;
    
    const player = await Player.findById(req.params.id).select("name imageUrl").lean();
    if (!player || isReservedTestName(player.name)) {
      return res.type("html").send(genericPreview(redirectUrl));
    }
    
    let image = "";
    if (player.imageUrl && player.imageUrl.startsWith("/uploads/")) {
      image = `${backendUrl}${player.imageUrl}`;
    } else if (player.imageUrl && player.imageUrl.startsWith("http")) {
      image = player.imageUrl;
    }
    
    res.type("html").send(
      buildShareHtml({
        title: player.name,
        description: `${player.name} on CricAll`,
        image,
        url: redirectUrl,
        redirectUrl,
      })
    );
  } catch (err) {
    const frontendUrl = getFrontendUrl();
    res.type("html").send(genericPreview(`${frontendUrl}/players/${req.params.id}`));
  }
};
