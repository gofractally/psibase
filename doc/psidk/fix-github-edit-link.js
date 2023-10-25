document.addEventListener("DOMContentLoaded", function() {
  const gitEditButton = document.getElementById("git-edit-button");
  if (gitEditButton) {
    const gitEditLink = gitEditButton.parentElement;
    const originalUrl = gitEditLink.getAttribute('href');
    const newUrl = originalUrl.replace('/root/psibase/', '/');
    gitEditLink.setAttribute('href', newUrl);
  }
});