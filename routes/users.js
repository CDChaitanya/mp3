module.exports = function (router) {
    var User = require('../models/user');
    var Task = require('../models/task');
    var mongoose = require('mongoose');

    function parseJSON(val, fallback) {
        if (val === undefined) return fallback;
        try { return JSON.parse(val); } catch (e) {
            var err = new Error('Invalid JSON for query parameter');
            err.status = 400; throw err;
        }
    }

    function ok(res, data, message='OK', code=200) {
        return res.status(code).json({ message, data });
    }
    function fail(res, message='Error', code=500, data=null) {
        return res.status(code).json({ message, data });
    }

    function buildListQuery(model, req) {
        var where  = parseJSON(req.query.where, {});
        var sort   = parseJSON(req.query.sort, undefined);
        var select = parseJSON(req.query.select, undefined);
        var skip   = req.query.skip !== undefined ? parseInt(req.query.skip, 10) : undefined;
        var limit  = req.query.limit !== undefined ? parseInt(req.query.limit, 10) : undefined;
        var count  = (req.query.count === 'true' || req.query.count === true);

        var q = model.find(where);
        if (sort)   q = q.sort(sort);
        if (select) q = q.select(select);
        if (Number.isInteger(skip))  q = q.skip(skip);
        if (Number.isInteger(limit)) q = q.limit(limit);
        return { q, count };
    }

    router.get('/', async function (req, res) {
        try {
            var b = buildListQuery(User, req);
            if (b.count) {
                var c = await User.countDocuments(b.q.getQuery());
                return ok(res, c, 'Count');
            }
            var docs = await b.q.exec();
            return ok(res, docs);
        } catch (err) {
            return fail(res, err.status ? err.message : 'Failed to fetch users', err.status || 500);
        }
    });

    router.get('/:id', async function (req, res) {
        try {
            var id = req.params.id;
            if (!mongoose.Types.ObjectId.isValid(id)) {
                return fail(res, 'User not found', 404);
            }
            var select = parseJSON(req.query.select, undefined);
            var q = User.findById(id);
            if (select) q = q.select(select);
            var doc = await q.exec();
            if (!doc) return fail(res, 'User not found', 404);
            return ok(res, doc);
        } catch (err) {
            return fail(res, 'Failed to fetch user', 500);
        }
    });

    router.post('/', async function (req, res) {
        try {
            var body = req.body || {};
            var name = body.name;
            var email = body.email;
            var pendingTasks = body.pendingTasks || [];

            if (!name || !email) return fail(res, 'Name and email are required', 400);

            var exists = await User.findOne({ email: email }).lean();
            if (exists) return fail(res, 'Email already exists', 400);

            if (pendingTasks && pendingTasks.length) {
                var tasks = await Task.find({ _id: { $in: pendingTasks } });
                
                if (tasks.length !== pendingTasks.length) {
                    return fail(res, 'One or more task IDs do not exist', 400);
                }
                
                var completedTask = tasks.find(function(t) { return t.completed === true; });
                if (completedTask) {
                    return fail(res, 'Cannot add completed tasks to pending tasks', 400);
                }
            }

            var user = await User.create({ name, email, pendingTasks });

            if (pendingTasks && pendingTasks.length) {
                var tasks = await Task.find({ _id: { $in: pendingTasks } });
                await Promise.all(tasks.map(async function (t) {
                    t.assignedUser = user._id.toString();
                    t.assignedUserName = user.name;
                    await t.save();
                }));
            }
            return ok(res, user, 'Created', 201);
        } catch (err) {
            var msg = err && err.errors ? Object.values(err.errors).map(e=>e.message).join('; ') : 'Failed to create user';
            return fail(res, msg, 400);
        }
    });

    router.put('/:id', async function (req, res) {
        try {
            var id = req.params.id;
            if (!mongoose.Types.ObjectId.isValid(id)) {
                return fail(res, 'User not found', 404);
            }
            var body = req.body || {};
            var name = body.name;
            var email = body.email;
            var pendingTasks = body.pendingTasks || [];

            if (!name || !email) return fail(res, 'Name and email are required', 400);

            var user = await User.findById(id);
            if (!user) return fail(res, 'User not found', 404);

            if (email !== user.email) {
                var exists = await User.findOne({ email: email }).lean();
                if (exists) return fail(res, 'Email already exists', 400);
            }

            if (pendingTasks && pendingTasks.length) {
                var tasks = await Task.find({ _id: { $in: pendingTasks } });
                
                if (tasks.length !== pendingTasks.length) {
                    return fail(res, 'One or more task IDs do not exist', 400);
                }
                
                var completedTask = tasks.find(function(t) { return t.completed === true; });
                if (completedTask) {
                    return fail(res, 'Cannot add completed tasks to pending tasks', 400);
                }
            }

            var prevSet = new Set((user.pendingTasks || []).map(String));
            var nextSet = new Set((pendingTasks || []).map(String));
            var toAdd = Array.from(nextSet).filter(x => !prevSet.has(x));
            var toRemove = Array.from(prevSet).filter(x => !nextSet.has(x));

            user.name = name;
            user.email = email;
            user.pendingTasks = Array.from(nextSet);
            await user.save();

            if (toRemove.length) {
                var removedTasks = await Task.find({ _id: { $in: toRemove } });
                await Promise.all(removedTasks.map(async function (t) {
                    if (t.assignedUser === id) {
                        t.assignedUser = '';
                        t.assignedUserName = 'unassigned';
                        await t.save();
                    }
                }));
            }
            if (toAdd.length) {
                var addedTasks = await Task.find({ _id: { $in: toAdd } });
                await Promise.all(addedTasks.map(async function (t) {
                    t.assignedUser = id;
                    t.assignedUserName = user.name;
                    await t.save();
                }));
            }

            return ok(res, user);
        } catch (err) {
            return fail(res, 'Failed to update user', 400);
        }
    });

    router.delete('/:id', async function (req, res) {
        try {
            var id = req.params.id;
            if (!mongoose.Types.ObjectId.isValid(id)) {
                return fail(res, 'User not found', 404);
            }
            var user = await User.findById(id);
            if (!user) return fail(res, 'User not found', 404);

            if (user.pendingTasks && user.pendingTasks.length) {
                var tasks = await Task.find({ _id: { $in: user.pendingTasks } });
                await Promise.all(tasks.map(async function (t) {
                    if (t.assignedUser === id) {
                        t.assignedUser = '';
                        t.assignedUserName = 'unassigned';
                        await t.save();
                    }
                }));
            }

            await user.deleteOne();
            return ok(res, null, 'Deleted', 204);
        } catch (err) {
            return fail(res, 'Failed to delete user', 500);
        }
    });

    return router;
};
