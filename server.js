const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();

// ====== CONFIG ======
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const POSTS_PER_PAGE = 5;

// ====== ENSURE FOLDERS/FILES ======
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(POSTS_FILE)) fs.writeFileSync(POSTS_FILE, '[]');

// ====== JSON HELPERS ======
function loadUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '[]');
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function normaliseUsers(users) {
    let changed = false;
    users.forEach(u => {
        if (!u.joinedAt) {
            u.joinedAt = Date.now();
            changed = true;
        }
        if (typeof u.isAdmin !== 'boolean') {
            u.isAdmin = false;
            changed = true;
        }
        if (typeof u.banned !== 'boolean') {
            u.banned = false;
            changed = true;
        }
        if (!Array.isArray(u.followers)) {
            u.followers = [];
            changed = true;
        }
        if (!Array.isArray(u.following)) {
            u.following = [];
            changed = true;
        }
    });
    if (changed) saveUsers(users);
    return users;
}

function loadPosts() {
    return JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8') || '[]');
}

function savePosts(posts) {
    fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
}

function normalisePosts(posts) {
    posts.forEach(p => {
        if (typeof p.likes !== 'number') p.likes = 0;
        if (!Array.isArray(p.likedBy)) p.likedBy = [];
        if (!Array.isArray(p.comments)) p.comments = [];
    });
    return posts;
}

// ====== MULTER (UPLOADS) ======
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        const safeName =
            Date.now() + '-' + Math.round(Math.random() * 1e9) + ext.toLowerCase();
        cb(null, safeName);
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
};

const upload = multer({ storage, fileFilter });

// ====== MIDDLEWARE ======
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: 'replace_this_with_a_long_random_string',
        resave: false,
        saveUninitialized: false
    })
);

app.use(express.static(path.join(__dirname, 'public')));

// Attach current user + isAdmin to all templates
app.use((req, res, next) => {
    let currentUser = null;
    let isAdmin = false;
    let users = [];

    if (req.session.username) {
        users = normaliseUsers(loadUsers());
        const u = users.find(x => x.username === req.session.username);
        if (u) {
            currentUser = u;
            isAdmin = !!u.isAdmin;
        }
    }

    res.locals.currentUser = currentUser ? currentUser.username : null;
    res.locals.currentUserObj = currentUser;
    res.locals.isAdmin = isAdmin;
    next();
});

// ====== ROUTES ======

// HOME / FEED with pagination
app.get('/', (req, res) => {
    let page = parseInt(req.query.page || '1', 10);
    if (isNaN(page) || page < 1) page = 1;

    let posts = normalisePosts(loadPosts());
    posts.sort((a, b) => b.createdAt - a.createdAt);

    const totalPages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
    if (page > totalPages) page = totalPages;

    const start = (page - 1) * POSTS_PER_PAGE;
    const pagePosts = posts.slice(start, start + POSTS_PER_PAGE);

    res.render('index', {
        posts: pagePosts,
        page,
        totalPages
    });
});

// TOP JOINTS (also paginated)
app.get('/top', (req, res) => {
    let page = parseInt(req.query.page || '1', 10);
    if (isNaN(page) || page < 1) page = 1;

    let posts = normalisePosts(loadPosts());
    posts.sort((a, b) => {
        const likesA = a.likes || 0;
        const likesB = b.likes || 0;
        if (likesB !== likesA) return likesB - likesA;
        return b.createdAt - a.createdAt;
    });

    const totalPages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
    if (page > totalPages) page = totalPages;

    const start = (page - 1) * POSTS_PER_PAGE;
    const pagePosts = posts.slice(start, start + POSTS_PER_PAGE);

    res.render('top', {
        posts: pagePosts,
        page,
        totalPages
    });
});

// RANDOM JOINT
app.get('/random', (req, res) => {
    let posts = normalisePosts(loadPosts());
    if (posts.length === 0) {
        return res.render('random', { post: null });
    }
    const idx = Math.floor(Math.random() * posts.length);
    const post = posts[idx];
    res.render('random', { post });
});

// ABOUT
app.get('/about', (req, res) => {
    res.render('about');
});

// USER PROFILE
app.get('/user/:username', (req, res) => {
    const username = req.params.username;
    let users = normaliseUsers(loadUsers());
    const user = users.find(u => u.username === username);

    if (!user) {
        return res.status(404).send('User not found.');
    }

    let posts = normalisePosts(loadPosts()).filter(p => p.author === username);
    posts.sort((a, b) => b.createdAt - a.createdAt);

    const totalPosts = posts.length;
    const totalLikes = posts.reduce((sum, p) => sum + (p.likes || 0), 0);

    const followersCount = user.followers ? user.followers.length : 0;
    const followingCount = user.following ? user.following.length : 0;

    res.render('user', {
        profileUser: user,
        posts,
        totalPosts,
        totalLikes,
        followersCount,
        followingCount
    });
});

// FOLLOW
app.post('/user/:username/follow', (req, res) => {
    if (!req.session.username) return res.redirect('/login');

    const targetName = req.params.username;
    const meName = req.session.username;

    if (targetName === meName) return res.redirect('/user/' + targetName);

    let users = normaliseUsers(loadUsers());
    const me = users.find(u => u.username === meName);
    const target = users.find(u => u.username === targetName);

    if (!me || !target) return res.redirect('/');

    if (!me.following.includes(targetName)) me.following.push(targetName);
    if (!target.followers.includes(meName)) target.followers.push(meName);

    saveUsers(users);
    res.redirect('/user/' + targetName);
});

// UNFOLLOW
app.post('/user/:username/unfollow', (req, res) => {
    if (!req.session.username) return res.redirect('/login');

    const targetName = req.params.username;
    const meName = req.session.username;

    if (targetName === meName) return res.redirect('/user/' + targetName);

    let users = normaliseUsers(loadUsers());
    const me = users.find(u => u.username === meName);
    const target = users.find(u => u.username === targetName);

    if (!me || !target) return res.redirect('/');

    me.following = me.following.filter(n => n !== targetName);
    target.followers = target.followers.filter(n => n !== meName);

    saveUsers(users);
    res.redirect('/user/' + targetName);
});

// LOGIN + REGISTER PAGES
app.get('/login', (req, res) => {
    if (req.session.username) return res.redirect('/');
    res.render('login', { error: null });
});

app.get('/register', (req, res) => {
    if (req.session.username) return res.redirect('/');
    res.render('register', { error: null });
});

// REGISTER
app.post('/register', (req, res) => {
    const { username, email, password, password2 } = req.body;
    let error = null;

    if (!username || !password || !password2) {
        error = 'Please fill in all required fields.';
    } else if (password !== password2) {
        error = 'Passwords do not match.';
    } else {
        let users = normaliseUsers(loadUsers());
        if (users.find(u => u.username === username)) {
            error = 'Username already taken.';
        } else {
            const isFirstUser = users.length === 0;
            users.push({
                username,
                email: email || '',
                passwordPlain: password, // ⚠ in real life, hash this
                joinedAt: Date.now(),
                isAdmin: isFirstUser,    // first user becomes admin
                banned: false,
                followers: [],
                following: []
            });
            saveUsers(users);
            req.session.username = username;
            return res.redirect('/');
        }
    }

    res.status(400);
    res.render('register', { error });
});

// LOGIN
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    let users = normaliseUsers(loadUsers());

    const user = users.find(
        u => u.username === username && u.passwordPlain === password
    );

    if (!user) {
        return res.status(401).render('login', {
            error: 'Invalid username or password.'
        });
    }

    if (user.banned) {
        return res.status(403).render('login', {
            error: 'Your account has been banned.'
        });
    }

    req.session.username = user.username;
    res.redirect('/');
});

// LOGOUT
app.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// UPLOAD JOINT (NEW POST)
app.post('/upload', upload.single('photo'), (req, res) => {
    if (!req.session.username) {
        return res.status(401).send('You must be logged in to upload.');
    }

    const { title, caption } = req.body;
    const file = req.file;

    if (!file) {
        return res.status(400).send('No image uploaded.');
    }

    const posts = normalisePosts(loadPosts());
    const now = Date.now();

    posts.push({
        id: now,
        title: title || 'Untitled Joint',
        caption: caption || '',
        imageFilename: file.filename,
        author: req.session.username,
        createdAt: now,
        likes: 0,
        likedBy: [],
        comments: []
    });

    savePosts(posts);
    res.redirect('/');
});

// LIKE / UNLIKE A POST
app.post('/posts/:id/like', (req, res) => {
    if (!req.session.username) {
        return res.redirect('/login');
    }

    const id = parseInt(req.params.id, 10);
    const posts = normalisePosts(loadPosts());
    const post = posts.find(p => p.id === id);

    if (!post) {
        return res.status(404).send('Post not found.');
    }

    const user = req.session.username;
    const idx = post.likedBy.indexOf(user);

    if (idx === -1) {
        post.likedBy.push(user);
        post.likes++;
    } else {
        post.likedBy.splice(idx, 1);
        post.likes--;
        if (post.likes < 0) post.likes = 0;
    }

    savePosts(posts);
    res.redirect('/');
});

// DELETE YOUR OWN POST
app.post('/posts/:id/delete', (req, res) => {
    if (!req.session.username) {
        return res.redirect('/login');
    }

    const id = parseInt(req.params.id, 10);
    let posts = normalisePosts(loadPosts());
    const post = posts.find(p => p.id === id);

    if (!post) {
        return res.status(404).send('Post not found.');
    }

    if (post.author !== req.session.username) {
        return res.status(403).send('You can only delete your own joints.');
    }

    posts = posts.filter(p => p.id !== id);
    savePosts(posts);
    res.redirect('/');
});

// ADD COMMENT TO A POST
app.post('/posts/:id/comments', (req, res) => {
    if (!req.session.username) {
        return res.redirect('/login');
    }

    const id = parseInt(req.params.id, 10);
    const text = (req.body.comment || '').trim();

    if (!text) {
        return res.redirect('/');
    }

    const posts = normalisePosts(loadPosts());
    const post = posts.find(p => p.id === id);

    if (!post) {
        return res.status(404).send('Post not found.');
    }

    const now = Date.now();

    post.comments.push({
        id: now,
        author: req.session.username,
        text,
        createdAt: now
    });

    savePosts(posts);
    res.redirect('/');
});

// DELETE COMMENT (by comment author or post author)
app.post('/posts/:postId/comments/:commentId/delete', (req, res) => {
    if (!req.session.username) {
        return res.redirect('/login');
    }

    const postId = parseInt(req.params.postId, 10);
    const commentId = parseInt(req.params.commentId, 10);

    const posts = normalisePosts(loadPosts());
    const post = posts.find(p => p.id === postId);

    if (!post) {
        return res.status(404).send('Post not found.');
    }

    const idx = post.comments.findIndex(c => c.id === commentId);
    if (idx === -1) {
        return res.status(404).send('Comment not found.');
    }

    const comment = post.comments[idx];
    const user = req.session.username;

    if (comment.author !== user && post.author !== user) {
        return res.status(403).send('You cannot delete this comment.');
    }

    post.comments.splice(idx, 1);
    savePosts(posts);
    res.redirect('/');
});

// ====== ADMIN PANEL ======
function requireAdmin(req, res, next) {
    if (!req.session.username) return res.redirect('/login');
    const users = normaliseUsers(loadUsers());
    const user = users.find(u => u.username === req.session.username);
    if (!user || !user.isAdmin) {
        return res.status(403).send('Admins only.');
    }
    next();
}

app.get('/admin', requireAdmin, (req, res) => {
    const users = normaliseUsers(loadUsers());
    const posts = normalisePosts(loadPosts());
    res.render('admin', { users, posts });
});

// admin delete any post
app.post('/admin/posts/:id/delete', requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    let posts = normalisePosts(loadPosts());
    posts = posts.filter(p => p.id !== id);
    savePosts(posts);
    res.redirect('/admin');
});

// admin ban / unban
app.post('/admin/users/:username/ban', requireAdmin, (req, res) => {
    const username = req.params.username;
    const users = normaliseUsers(loadUsers());
    const user = users.find(u => u.username === username);
    if (user) {
        user.banned = true;
        saveUsers(users);
    }
    res.redirect('/admin');
});

app.post('/admin/users/:username/unban', requireAdmin, (req, res) => {
    const username = req.params.username;
    const users = normaliseUsers(loadUsers());
    const user = users.find(u => u.username === username);
    if (user) {
        user.banned = false;
        saveUsers(users);
    }
    res.redirect('/admin');
});

// admin make admin
app.post('/admin/users/:username/make-admin', requireAdmin, (req, res) => {
    const username = req.params.username;
    const users = normaliseUsers(loadUsers());
    const user = users.find(u => u.username === username);
    if (user) {
        user.isAdmin = true;
        saveUsers(users);
    }
    res.redirect('/admin');
});

// ====== START SERVER ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('JointsGalore live at http://localhost:' + PORT);
});
