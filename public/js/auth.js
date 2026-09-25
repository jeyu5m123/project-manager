(function () {
  var userData = null;

  function getQueryParam(name) {
    var match = window.location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  var tokenFromUrl = getQueryParam('token');
  if (tokenFromUrl) {
    API.setToken(tokenFromUrl);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  function fetchCurrentUser() {
    return API.get('/auth/me').then(function (user) {
      userData = user;
      return user;
    });
  }

  function signup(username, password, name) {
    return API.post('/auth/signup', { username: username, password: password, name: name });
  }

  function login(username, password, rememberMe) {
    return API.post('/auth/login', { username: username, password: password, rememberMe: rememberMe }).then(function (res) {
      API.setToken(res.token, rememberMe);
      return fetchCurrentUser();
    });
  }

  function verifyEmail(token) {
    return API.post('/auth/verify', { token: token });
  }

  function forgotPassword(email) {
    return API.post('/auth/forgot', { email: email });
  }

  function resetPassword(token, password) {
    return API.post('/auth/reset', { token: token, password: password });
  }

  function logout() {
    API.setToken(null);
    userData = null;
    window.location.reload();
  }

  function getUser() {
    return userData;
  }

  function isAuthenticated() {
    return API.isLoggedIn();
  }

  window.Auth = {
    signup: signup,
    login: login,
    verifyEmail: verifyEmail,
    forgotPassword: forgotPassword,
    resetPassword: resetPassword,
    logout: logout,
    fetchCurrentUser: fetchCurrentUser,
    getUser: getUser,
    isAuthenticated: isAuthenticated,
  };
})();
