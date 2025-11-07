module.exports = function (router) {
    var Task = require('../models/task');
    var User = require('../models/user');
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
        var skip   = req.query.skip !== undefined ? parseInt(req.query.skip) : undefined;
        var limit  = req.query.limit !== undefined ? parseInt(req.query.limit) : undefined;
        var count  = (req.query.count === 'true' || req.query.count === true);

        var q = model.find(where);
        if (sort)   q = q.sort(sort);
        if (select) q = q.select(select);
        if (Number.isInteger(skip))  q = q.skip(skip);
        if (Number.isInteger(limit)) q = q.limit(limit);
        return { q, count };
    }

    async function syncUserPending(task, prevAssignedUserId) {
        var isPending = task.completed === false;
        var newUserId = task.assignedUser || '';

        if (prevAssignedUserId && prevAssignedUserId !== newUserId) {
            var prevUser = await User.findById(prevAssignedUserId);
            if (prevUser) {
                prevUser.pendingTasks = prevUser.pendingTasks.filter(function (tid) {
                    return tid !== task._id.toString();
                });
                await prevUser.save();
            }
        }

        if (newUserId) {
            var user = await User.findById(newUserId);
            if (user) {
                var tid = task._id.toString();
                var has = user.pendingTasks.includes(tid);
                if (isPending && !has) {
                    user.pendingTasks.push(tid);
                    await user.save();
                }
                if (!isPending && has) {
                    user.pendingTasks = user.pendingTasks.filter(function (x) { return x !== tid; });
                    await user.save();
                }
                task.assignedUserName = user.name;
            } else {
                task.assignedUser = '';
                task.assignedUserName = 'unassigned';
            }
        } else {
            task.assignedUserName = 'unassigned';
        }
    }

    router.get('/', async function (req, res) {
        try {
            var b = buildListQuery(Task, req);
            if (b.count) {
                var c = await Task.countDocuments(b.q.getQuery());
                return ok(res, c, 'Count');
            }
            var docs = await b.q.exec();
            return ok(res, docs);
        } catch (err) {
            return fail(res, err.status ? err.message : 'Failed to fetch tasks', err.status || 500);
        }
    });

    router.get('/:id', async function (req, res) {
        try {
            var id = req.params.id;
            if (!mongoose.Types.ObjectId.isValid(id)) {
                return fail(res, 'Task Invalid', 400);
            }
            var select = parseJSON(req.query.select, undefined);
            var q = Task.findById(id);
            if (select) q = q.select(select);
            var doc = await q.exec();
            if (!doc) return fail(res, 'Task not found', 404);
            return ok(res, doc);
        } catch (err) {
            return fail(res, 'Failed to fetch task', 500);
        }
    });

    router.post('/', async function (req, res) {
        try {
            var body = req.body || {};
            var name = body.name;
            var deadline = body.deadline;
            if (!name || !deadline) return fail(res, 'Task name and deadline are required', 400);

            var assignedUser = body.assignedUser || '';
            var assignedUserName = 'unassigned';

            if (assignedUser) {
                if (!mongoose.Types.ObjectId.isValid(assignedUser)) {
                    return fail(res, 'Invalid user ID', 400);
                }
                var user = await User.findById(assignedUser);
                if (!user) {
                    return fail(res, 'Assigned user does not exist', 404);
                }

                if (body.assignedUserName !== undefined) {
                    if (body.assignedUserName !== user.name) {
                        return fail(res, 'Assigned user name does not match the user', 400);
                    }
                    assignedUserName = body.assignedUserName;
                } else {
                    assignedUserName = user.name;
                }
            } else {
                if (body.assignedUserName !== undefined && body.assignedUserName !== 'unassigned') {
                    assignedUserName = body.assignedUserName;
                }
            }

            var task = await Task.create({
                name: name,
                description: body.description || '',
                deadline: deadline,
                completed: body.completed === true,
                assignedUser: assignedUser,
                assignedUserName: assignedUserName
            });

            await syncUserPending(task, null);
            await task.save();

            return ok(res, task, 'Created', 201);
        } catch (err) {
            var msg = err && err.errors ? Object.values(err.errors).map(e=>e.message).join('; ') : 'Failed to create task';
            return fail(res, msg, 400);
        }
    });

    router.put('/:id', async function (req, res) {
        try {
            var id = req.params.id;
            if (!mongoose.Types.ObjectId.isValid(id)) {
                return fail(res, 'Task Invalid', 400);
            }
            var body = req.body || {};
            var name = body.name;
            var deadline = body.deadline;
            var completed = body.completed;

            if (!name || !deadline) {
                return fail(res, 'Task name and deadline are required', 400);
            }

            var task = await Task.findById(id);
            if (!task) return fail(res, 'Task not found', 404);
            if (task.completed === true) {
                return fail(res, 'Cannot modify a completed task', 400);
            }

            var assignedUser = body.assignedUser !== undefined ? body.assignedUser : task.assignedUser;
            var assignedUserName = task.assignedUserName;

            if (assignedUser) {
                if (!mongoose.Types.ObjectId.isValid(assignedUser)) {
                    return fail(res, 'Invalid user ID', 400);
                }
                var user = await User.findById(assignedUser);
                if (!user) {
                    return fail(res, 'Assigned user does not exist', 404);
                }

                if (body.assignedUserName !== undefined) {
                    if (body.assignedUserName !== user.name) {
                        return fail(res, 'Assigned user name does not match the user', 400);
                    }
                    assignedUserName = body.assignedUserName;
                } else {
                    assignedUserName = user.name;
                }
            } else {
                assignedUserName = 'unassigned';
                if (body.assignedUserName !== undefined && body.assignedUserName !== 'unassigned') {
                    assignedUserName = body.assignedUserName;
                }
            }

            var prevAssigned = task.assignedUser || '';

            task.name = name;
            task.description = body.description || '';
            task.deadline = deadline;
            task.completed = completed !== undefined ? !!completed : task.completed;
            task.assignedUser = assignedUser || '';
            task.assignedUserName = assignedUserName;

            await syncUserPending(task, prevAssigned);
            await task.save();

            return ok(res, task);
        } catch (err) {
            return fail(res, 'Failed to update task', 400);
        }
    });

    router.delete('/:id', async function (req, res) {
        try {
            var id = req.params.id;
            if (!mongoose.Types.ObjectId.isValid(id)) {
                return fail(res, 'Task Invalid', 400);
            }
            var task = await Task.findById(id);
            if (!task) return fail(res, 'Task not found', 404);

            var prevAssigned = task.assignedUser || '';
            if (prevAssigned) {
                var user = await User.findById(prevAssigned);
                if (user) {
                    user.pendingTasks = user.pendingTasks.filter(function (tid) {
                        return tid !== task._id.toString();
                    });
                    await user.save();
                }
            }

            await task.deleteOne();
            return ok(res, null, 'Deleted', 204);
        } catch (err) {
            return fail(res, 'Failed to delete task', 500);
        }
    });

    return router;
};
