# Copyright (C) 2020  Marius Steffens, CISPA
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

import z3
import json
import sys
import fileinput
import logging
import random
import string
from RegexToZ3 import regex_to_z3
from collections import defaultdict as dd

identifier_substitutions = dict()
GLOBAL_IDENTIFIER = set()
MAKE_UNSOLVABLE = set()
ARRAY_LENGTHS = dict()


class NotSupportedException(Exception):
    pass


def randomString(length=20):
    return ''.join([random.choice(string.ascii_letters + string.digits) for i in range(length)])


def enableLogging():
    logging.basicConfig(level=logging.DEBUG)


# https://stackoverflow.com/questions/5574702/how-to-print-to-stderr-in-python
def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


BinaryFunctions = {
    "==": lambda left, right: left == right,
    "===": lambda left, right: left == right,

    "!=": lambda left, right: left != right,
    "!==": lambda left, right: left != right,

    "<": lambda left, right: left < right,
    ">": lambda left, right: left > right,

    "<=": lambda left, right: left <= right,
    ">=": lambda left, right: left >= right,

    "+": lambda left, right: left + right,
    "-": lambda left, right: left - right,

    "*": lambda left, right: left * right,
    "/": lambda left, right: left / right,

    "%": lambda left, right: left % right,

    ">>": lambda left, right: left >> right,
    "<<": lambda left, right: left << right,
    # ">>>": lambda left, right: left >>> right,

    "&": lambda left, right: left & right,
    "&&": lambda left, right: z3.And(left, right),

    "|": lambda left, right: left | right,
    "||": lambda left, right: z3.Or(left, right),

    "^": lambda left, right: left ^ right,
    "instanceof": lambda left, right: binary_instanceof(left, right),
    "in": lambda left, right: binary_in(left, right)
}
infered_types = dd(lambda: '')


def binary_in(left, right):
    if right.decl().kind() == z3.Z3_OP_UNINTERPRETED and z3.is_string_value(left):
        identifer = str(right.decl())
        accessed = left.as_string()
        st = z3.String(identifer + '.' + accessed)
        GLOBAL_CONSTRAINTS.append(createZ3ForBool(st))
    else:
        # When this is not the case we cannot enforce any constraints so it is up to the application ot have these properties
        pass

    return z3.BoolVal(True)


def binary_instanceof(left, right):
    if z3.is_string_value(right) and right.as_string() == '':
        right = None

    if left.decl().kind() == z3.Z3_OP_UNINTERPRETED:
        typ_val = z3.String('type:' + str(left.decl()))
        if right is None:
            return typ_val == z3.StringVal('undefined')
        else:
            raise Exception(
                'we have not yet seen', right, 'as type')
    else:
        raise Exception(
            'We probably need to introduce intermediary variables here and assert that their type is something specific')


PYTHON_TO_JS_TYPES = {
    str: 'string',
    int: 'number',
    dict: 'object',
}

UnaryFunctions = {
    "!": lambda val: z3.mk_not(createZ3ForBool(val)),
    "~": lambda val: -(val + 1),
    "-": lambda val: -val,
    "+": lambda val: +val,
    # "typeof": lambda val: z3.StringVal(PYTHON_TO_JS_TYPES[type(val)]),
    # "typeof": lambda val: z3.String('type:' + str(val.decl())),
    "typeof": lambda val: unary_typeof(val),
}


def unary_typeof(val):
    typo = z3.String('type:' + str(val.decl()))
    return z3.String('type:' + str(val.decl()))


StringFunctions = {
    # no op since we assume things to be strings and adjust this later when putting together the event
    'toString': lambda x, args: x,
    'indexOf': lambda x, args: string_indexOf(x, args),
    'search': lambda x, args: string_search(x, args),
    'substr': lambda x, args: string_substring(x, args),
    'substring': lambda x, args: string_substring(x, args),
    'slice': lambda x, args: string_slice(x, args),
    'split': lambda x, args: string_split(x, args),

    'match': lambda x, args: string_match(x, args),
    'startsWith': lambda x, args: z3.PrefixOf(createZ3ExpressionFromConstraint(args[0], {}), x),
    'endsWith': lambda x, args: z3.SuffixOf(createZ3ExpressionFromConstraint(args[0], {}), x),
    'replace': lambda x, args: string_replace(x, args),
    # these functions should in our case of exploiting things make no difference in constraint solving
    'toLowerCase': lambda x, args: x,
    'trim': lambda x, args: x,
    'includes': lambda x, args: includes(x, args),
    'concat': lambda x, args: string_concat(x, args),

    # FIXME technically not a string function
    # map is a noop operation for us, as the constraints that are mapped on the single values will have
    # the correct operations on them after the map call anyway
    'map': lambda x, args: x,
    # assumption: on checked properties we find other traces
    'hasOwnProperty': lambda x, args: z3.BoolVal(True),

}

ArrayFunctions = {
    'pop': lambda x, args: array_pop(x, args)
}


def array_pop(x, args):
    return GLOBAL_ARRAY_HANDLER[x][-1]


GLOBAL_ARRAY_HANDLER = dd(list)


def includes(x, args):
    if z3.is_string(x):
        return string_indexOf(x, args) > -1
    elif z3.is_array(x):
        if str(x.decl()) not in ARRAY_LENGTHS:
            raise Exception('We do not know how large the underlying array should be thus we cannot include on it')
        cc = None
        searched = createZ3ExpressionFromConstraint(args[0], {})
        for i in range(ARRAY_LENGTHS[str(x.decl())]):
            c = z3.Select(x, i) == searched
            if cc is None:
                cc = c
            else:
                cc = z3.Or(cc, c)
        return cc
    else:
        raise Exception('What else should we expect to be called includes on instead of strings and arrays')


def string_concat(x, args):
    cc = x
    if z3.is_string(x):
        for y in args:
            cc = z3.Concat(cc, createZ3ExpressionFromConstraint(y, {}))
        return cc
    else:
        raise NotSupportedException('We only support concat on stirngs as arrays are difficult in z3.')


def string_indexOf(x, args):
    if z3.is_array(x):
        if str(x.decl()) not in ARRAY_LENGTHS:
            raise Exception('We do not know how large the underlying array should be thus we cannot include on it')
        helper_int = z3.Int('__ignore_arr_indexOf_helper_' + randomString())
        search_string = createZ3ExpressionFromConstraint(args[0], {})
        all = []
        presentImplications = []
        for i in range(ARRAY_LENGTHS[str(x.decl())]):
            conditional = z3.Select(x, i) == search_string
            all.append(conditional)
            true_imply = z3.Implies(conditional, helper_int <= i)
            false_imply = z3.Implies(z3.Not(conditional), helper_int > i)
            presentImplications.append(true_imply)
            presentImplications.append(false_imply)
        all = z3.Or(all)
        GLOBAL_CONSTRAINTS.append(z3.And(z3.Implies(all, z3.And(presentImplications)), z3.Implies(all, helper_int >= 0),
                                         z3.Implies(z3.mk_not(all), helper_int == -1)))
        return helper_int

    else:
        if len(args) > 1:
            return z3.IndexOf(x, createZ3ExpressionFromConstraint(args[0], {}),
                              createZ3ExpressionFromConstraint(args[1], {}))
        else:
            return z3.IndexOf(x, createZ3ExpressionFromConstraint(args[0], {}), 0)


def string_match(x, args):
    if type(args[0]) == dict:
        # we know that they used some parts of the tainted data as regex
        val = createZ3ExpressionFromConstraint(args[0], {})
        # we know that its a direct flow and thus we can handle this with ease
        return z3.IndexOf(x, val, 0) > -1

    else:
        return z3.InRe(x, regex_to_z3(args[0]))


def string_substring(x, args):
    startIndex = createZ3ExpressionFromConstraint(args[0], {})
    endIndex = lenOfZ3(x)
    if len(args) == 2:
        endIndex = createZ3ExpressionFromConstraint(args[1], {})

    return z3.SubString(x, startIndex, endIndex)


def string_replace(x, args):
    search_val = createZ3ExpressionFromConstraint(args[0], {})
    replace_val = createZ3ExpressionFromConstraint(args[1], {})
    if replace_val is None:
        replace_val = ''
    return z3.Replace(x, search_val, replace_val)


def string_split(x, args):
    st = x
    split_val = z3.StringVal(args[0].encode())
    x = transformNonBooleanLazyEvaluations(x)
    arr = z3.Array('__ignore_{}.split({})'.format(str(x), str(args[0])), z3.IntSort(), z3.StringSort())
    for i in range(3):
        index = z3.IndexOf(st, split_val, 0)
        s = z3.SubString(st, 0, index)
        st = z3.SubString(st, index + z3.Length(split_val), z3.Length(st))
        GLOBAL_CONSTRAINTS.append(z3.Select(arr, i) == s)
        GLOBAL_CONSTRAINTS.append(s != z3.StringVal(''))
        GLOBAL_ARRAY_HANDLER[arr].append(s)
    GLOBAL_CONSTRAINTS.append(z3.Select(arr, 3) == st)
    GLOBAL_CONSTRAINTS.append(st != z3.StringVal(''))
    GLOBAL_ARRAY_HANDLER[arr].append(st)
    # We just guess the length here and hope that this works for the program
    ARRAY_LENGTHS[str(arr.decl())] = 4

    GLOBAL_CONSTRAINTS.append(z3.IndexOf(GLOBAL_ARRAY_HANDLER[arr][-1], split_val, 0) == -1)
    # GLOBAL_CONSTRAINTS.append(z3.PrefixOf(GLOBAL_ARRAY_HANDLER[arr][0], x))

    return arr


def string_search(x, args):
    new_val = z3.String('__ignore_search_helper_' + randomString())
    regex = args[0]
    startsWith = False
    endsWith = False

    if regex[0] == '^':
        startsWith = True
        regex = regex[1:]
    if regex[-1] == '$':
        endsWith = True
        regex = regex[:-1]
    GLOBAL_CONSTRAINTS.append(z3.InRe(new_val, regex_to_z3(args[0])))

    if startsWith and endsWith:
        # we need to return the index which should be 0 iff it matches
        GLOBAL_CONSTRAINTS.append(x == new_val)
        return z3.IntVal(0)
    elif startsWith:
        GLOBAL_CONSTRAINTS.append(z3.PrefixOf(new_val, x))
    elif endsWith:
        GLOBAL_CONSTRAINTS.append(z3.SuffixOf(new_val, x))
    return z3.IndexOf(x, new_val, 0)


def string_slice(x, args):
    if len(args) == 2:
        start = args[0]
        end = args[1]
    else:
        start = args[0]
        end = lenOfZ3(x)

    if type(start) != int:
        start = createZ3ExpressionFromConstraint(start, {})
    if type(end) != int and not z3.is_int(end):
        end = createZ3ExpressionFromConstraint(end, {})

    if type(start) == int and start < 0:
        GLOBAL_CONSTRAINTS.append(z3.Length(x) > -start)
        start = end + start

    if (z3.is_int(start) or type(start) == int) and (z3.is_int(start) or type(start) == int):
        return z3.SubString(x, start, end)
    else:
        raise NotSupportedException('')


GLOBAL_CONSTRAINTS = []


def lenOfZ3(obj):
    if type(obj) == str or type(obj) == list:
        return len(obj)

    if z3.is_string(obj):
        return z3.Length(obj)

    raise Exception('Need to calculate length of unknown object')


def getTypedZ3ValFromIdentifier(identifier, types):
    if type(identifier) == dict:
        # FIXME how can we handle this here
        raise NotSupportedException('Complex objects as base for operations cannot be modelled in z3')
    if type(identifier) == list:
        arr = z3.Array('ignore_helper_constant_array_' + randomString(), z3.IntSort(), z3.StringSort())
        for i, arg in enumerate(identifier):
            GLOBAL_CONSTRAINTS.append(z3.Select(arr, i) == createZ3ExpressionFromConstraint(arg, types))
        ARRAY_LENGTHS[str(arr.decl())] = len(identifier)
        return arr

    cur_types = types
    GLOBAL_IDENTIFIER.add(identifier)
    cur_types = infered_types[identifier]
    # if cur_types == 'object':
    #    infered_types[identifier] = ''
    #    cur_types = ''
    if identifier.endswith('.length'):
        return z3.Length(z3.String(identifier[:-7]))

    if cur_types == 'string':
        return z3.String(identifier)
    elif cur_types == 'number':
        return z3.Int(identifier)
    elif cur_types == 'boolean':
        return z3.Bool(identifier)
    elif cur_types == 'array':
        return z3.Array(identifier, z3.IntSort(), z3.StringSort())

    if 'event.data' in identifier or 'event.origin' in identifier or 'event' == identifier:
        return z3.String(identifier)
    else:
        MAKE_UNSOLVABLE.add(identifier)
        return z3.String(identifier)


def resolveOpsOnParent(op_obj, types):
    # this is parent or nothing
    if len(op_obj['old_ops']) < 1:
        return None
    val = createZ3ExpressionFromConstraint({'identifier': op_obj['old_identifier'], 'ops': op_obj['old_ops']}, types)

    if val is None or (val.decl().kind() == z3.Z3_OP_UNINTERPRETED and not z3.is_array(val)):
        # this is the case when the parent elems have no ops on them
        return None
    if z3.is_bool(val) and len(val.children()) and val.children()[0].decl().kind() == z3.Z3_OP_UNINTERPRETED:
        return None
    val = transformNonBooleanLazyEvaluations(val)
    return val


def createZ3ForBool(var):
    if z3.is_int(var):
        return var != z3.IntVal(0)
    elif z3.is_string(var):
        return var != z3.StringVal('')
    elif z3.is_array(var):
        return z3.BoolVal(True)
    elif z3.is_bool(var):
        return var
    elif var is None:
        # this should be the case when we have a JSON value that is just inside a conditional etc
        return None
    elif z3.is_seq(var):
        # not string but still something ref-like we only found cases where this was string comparisons using <, >, etc.
        return var
    else:
        raise Exception('unhandled type in uninterpreted if')


def createZ3ForIf(constraint, types):
    var = createZ3ExpressionFromConstraint(constraint, types)
    return createZ3ForBool(var)
    return var


def transformNonBooleanLazyEvaluations(var):
    if z3.is_or(var):
        # in this case it needs to be the first child since we are using it as a first child when coercing any expression to bool
        left = var.children()[0].children()[0]
        if len(var.children()[1].children()) == 0:
            if str(var.children()[1]) == 'False':
                return left
            else:

                raise Exception('Why would the lazy side of the or be a truthy value?')
        else:
            right = var.children()[1].children()[0]
        sub = z3.String('__ignore({}||{})'.format(str(left), str(right)))

        GLOBAL_CONSTRAINTS.append(z3.Or(left == sub, right == sub))
        return sub

    if z3.is_and(var):
        # FIXME what about the first child
        # in this case it needs to be the first child since we are using it as a first child when coercing any expression to bool
        right = var.children()[1].children()[0]
        # this is by construction the not null of the first
        GLOBAL_CONSTRAINTS.append(var.children()[0])

        return right

    return var


def coerceTypesIfPossible(var, other_var):
    if z3.is_or(other_var) and not z3.is_bool(var):
        other_var = transformNonBooleanLazyEvaluations(other_var)
    if z3.is_or(var) and not z3.is_bool(other_var):
        var = transformNonBooleanLazyEvaluations(var)

    if z3.is_and(other_var) and not z3.is_bool(var):
        other_var = transformNonBooleanLazyEvaluations(other_var)
    if z3.is_and(var) and not z3.is_bool(other_var):
        var = transformNonBooleanLazyEvaluations(var)
    if var.decl().kind() == z3.Z3_OP_UNINTERPRETED:
        if z3.is_bool(other_var) and not z3.is_bool(var):
            infered_types[str(var)] = 'boolean'
            return z3.Bool(str(var)), other_var
        if z3.is_string(other_var) and not z3.is_string(var):
            if other_var.as_string() == '':
                # we probably dont want to coerce in this specific case as this is merely a non empty check
                if z3.is_bool(var):
                    return var, z3.BoolVal(False)
                if z3.is_int(var):
                    return var, z3.IntVal(0)
            else:
                infered_types[str(var)] = 'string'
                return z3.String(str(var)), other_var
        if z3.is_int(other_var) and not z3.is_int(var):
            infered_types[str(var)] = 'number'
            return z3.Int(str(var)), other_var
    elif var.decl().kind() == z3.Z3_OP_UNINTERPRETED:
        if z3.is_bool(var):
            infered_types[str(var)] = 'boolean'
        if z3.is_string(var):
            infered_types[str(var)] = 'string'
        if z3.is_int(var):
            infered_types[str(var)] = 'number'
    else:
        # this means that it is non-interpreted and we need to coerce other var to the type of var
        if z3.is_string(var) and z3.is_int_value(other_var):
            other_var = z3.StringVal(str(other_var))
        if z3.is_arith(var) and z3.is_string(other_var):
            other_var = z3.IntVal(int(other_var.as_string()))

    return var, other_var


def getZ3ValFromJSVal(val):
    if type(val) == str:
        return z3.StringVal(val)
    if type(val) == bool:
        return z3.BoolVal(val)
    if type(val) == int:
        return z3.IntVal(val)
    if type(val) == int:
        return z3.IntVal(val)
    if type(val) == list:
        arr = z3.Array('ignore_helper_constant_array_' + randomString(), z3.IntSort(), z3.StringSort())
        for i, arg in enumerate(val):
            GLOBAL_CONSTRAINTS.append(z3.Select(arr, i) == createZ3ExpressionFromConstraint(arg, {}))
        ARRAY_LENGTHS[str(arr.decl())] = len(val)
        return arr
    if type(val) == dict:
        raise NotSupportedException('Complex Objects as base for operations with proxy strings are not yet supported!')

    raise Exception('Could not transform Js val to Z3 Val' + repr(val))


def checkForTypeEqualToString(var, other_var, op):
    res = None
    if var.decl().kind() == z3.Z3_OP_UNINTERPRETED and str(var.decl()).startswith('type:') and \
            op['val'] == 'string' and op['op'] in ['==', '===']:
        res = z3.Or(var == other_var, var == z3.StringVal('JSON'))
    elif other_var.decl().kind() == z3.Z3_OP_UNINTERPRETED and str(other_var.decl()).startswith('type:') and \
            op['val'] == 'string' and op['op'] in ['==', '===']:
        res = z3.Or(var == other_var, other_var == z3.StringVal('JSON'))
    elif var.decl().kind() == z3.Z3_OP_UNINTERPRETED and str(var.decl()).startswith('type:') and \
            op['val'] == 'string' and op['op'] in ['!=', '!==']:
        res = z3.And(var == other_var, var == z3.StringVal('JSON'))
    elif other_var.decl().kind() == z3.Z3_OP_UNINTERPRETED and str(other_var.decl()).startswith('type:') and \
            op['val'] == 'string' and op['op'] in ['!=', '!==']:
        res = z3.And(var == other_var, other_var == z3.StringVal('JSON'))
    return res


def createZ3ExpressionFromConstraint(constraint, types, emitParentConstraint=True):
    if type(constraint) != dict:
        if type(constraint) == str:
            return z3.StringVal(constraint)
        if type(constraint) == int:
            return z3.IntVal(constraint)
        if type(constraint) == bool:
            return z3.BoolVal(constraint)
        if constraint is None:
            return None
        raise Exception('Dealing with non-int non-string basic values, aborting!', constraint)
    if 'type' not in constraint:
        if 'isRealValue' in constraint:
            if 'value' in constraint:
                var = getZ3ValFromJSVal(constraint['value'])
            elif 'val' in constraint:
                var = getZ3ValFromJSVal(constraint['val'])
            else:
                raise Exception('Should not encounter realValue without reference to the real value...')
        else:
            if 'identifier' in constraint:
                var = getTypedZ3ValFromIdentifier(constraint['identifier'], types)
            else:
                # probably the empty object when we have something || {}
                return None

        for op in constraint['ops']:
            if 'val' not in op:
                op['val'] = ''
            if op['type'] == 'ops_on_parent_element':
                val = resolveOpsOnParent(op, types)
                if z3.is_array(val):
                    accesed = constraint['identifier'].split('.')[-1]
                    if accesed == 'length':
                        raise NotSupportedException(
                            'z3 cannot use the length of arrays due to their representation as functions')
                    if int(accesed) < 0 and str(val.decl()) in ARRAY_LENGTHS:
                        var = z3.Select(val, ARRAY_LENGTHS[str(val.decl())] + int(accesed))
                    else:
                        var = z3.Select(val, int(accesed))
                elif val is not None:
                    key = str(val)
                    if key not in identifier_substitutions:
                        identifier_substitutions[key] = '__substitute_values_' + randomString()
                    identifier = identifier_substitutions[key]
                    GLOBAL_CONSTRAINTS.append(val == z3.StringVal(identifier))
                    accesed = constraint['identifier'].split('.')[-1]
                    if accesed == 'length':
                        var = z3.Length(z3.String(identifier))
                    else:
                        var = z3.String(identifier + '.' + accesed)

                #     GLOBAL_CONSTRAINTS.append(var == val)
            elif op['type'] == 'member_function':
                var = transformNonBooleanLazyEvaluations(var)
                if op['function_name'] in StringFunctions:
                    var = StringFunctions[op['function_name']](var, op['args'])
                elif op['function_name'] in ArrayFunctions:
                    var = ArrayFunctions[op['function_name']](var, op['args'])
                else:
                    if op['function_name'] in ['call', 'apply', 'bind']:
                        raise NotSupportedException('We do not support function calls over function pointer')
                    raise Exception('String function not supported! ' + op['function_name'])
            elif op['type'] == 'Binary':
                other_var = createZ3ExpressionFromConstraint(op['val'], types)
                if other_var is None:
                    # this is the case when we compare something to null
                    if op['op'] == '===' or op['op'] == '==':
                        var = createZ3ForBool(var)
                        var = z3.Not(var)
                    continue
                var, other_var = coerceTypesIfPossible(var, other_var)
                changed = checkForTypeEqualToString(var, other_var, op)
                if changed is not None:
                    var = changed
                elif op['side'] == 'left':
                    var = BinaryFunctions[op['op']](var, other_var)
                elif op['side'] == 'right':
                    var = BinaryFunctions[op['op']](other_var, var)
                else:
                    var = BinaryFunctions[op['op']](var, other_var)
            elif op['type'] == 'Unary':
                var = UnaryFunctions[op['op']](var)
            elif op['type'] == 'iterator':
                if z3.is_array(var):
                    var = z3.Select(var, op['accessed_elem'])
                else:
                    raise Exception('This should always be an array', var, infered_types)
            elif op['type'] == 'external_function':
                if op['function_name'] == 'JSON.parse':
                    infered_types[constraint['identifier']] = 'JSON'
                    var = z3.String(constraint['identifier'])
                else:
                    logging.debug('Arbitrary external functions not yet support ' + op['function_name'])
            elif op['type'] == 'Logical':
                if op['side'] == 'left' or op['side'] == 'both':
                    l_c = createZ3ForBool(var)
                    r_c = createZ3ForBool(createZ3ExpressionFromConstraint(op['val'], types))
                else:
                    l_c = createZ3ForBool(createZ3ExpressionFromConstraint(op['val'], types))
                    r_c = createZ3ForBool(var)
                if l_c is None or r_c is None:
                    if l_c is None:
                        var = r_c
                    if r_c is None:
                        var = l_c
                    continue
                if op['op'] == '&&':
                    var = z3.And(l_c, r_c)
                else:
                    var = z3.Or(l_c, r_c)
            else:
                logging.debug('Not supported type ' + op['type'])
        return var
    elif constraint['type'] == 'Logical':
        l_c = createZ3ForBool(createZ3ExpressionFromConstraint(constraint['l_val'], types))
        r_c = createZ3ForBool(createZ3ExpressionFromConstraint(constraint['r_val'], types))
        if l_c is None or r_c is None:
            return l_c or r_c
        if constraint['op'] == '&&':
            return z3.And(l_c, r_c)
        else:
            return z3.Or(l_c, r_c)
    elif constraint['type'] == 'Binary':
        return BinaryFunctions[constraint['op']](createZ3ExpressionFromConstraint(constraint['l_val'], types),
                                                 createZ3ExpressionFromConstraint(constraint['r_val'], types))
    elif constraint['type'] == 'Unary':
        return UnaryFunctions[constraint['op']](createZ3ExpressionFromConstraint(constraint['val'], types))
    else:
        raise Exception('Unexpected constraint type')


def AssignementsToString(val, model):
    if type(val) == z3.z3.ArrayRef:
        vals = []
        # Just print out the first 5 values of array, we do not really know how
        # many elements need to be in the array due to z3 handling arrays as functions
        for i in range(3):
            vals.append(AssignementsToString(model.eval(val[i]), model))
        return vals
    if z3.is_string(val):
        return val.as_string()
    if z3.is_int(val):
        return int(str(val))
    if z3.is_bool(val):
        if str(val) == 'False':
            return False
        return True

    raise Exception('solved assignement type is neither int nor string, what to do?')


def addTypesFromTaintAnalysis(accessorpath, types):
    for entry in types:
        if type(types[entry]) != dict:
            infered_types[accessorpath + '.' + entry] = types[entry]
        else:
            addTypesFromTaintAnalysis(accessorpath + '.' + entry, types[entry])


def solveConstrains(constraints, types, shouldPrint=True):
    if type(types) == dict:
        addTypesFromTaintAnalysis('event', types['event'])
    else:
        for [iden, typo] in types:
            if type(iden) == str:
                infered_types[iden] = typo
    logging.debug(infered_types)
    c = True
    for constraint in constraints:
        cc = createZ3ForIf(constraint, types)
        logging.debug(cc)
        if z3.is_int(cc):
            cc = cc != 0
        elif z3.is_string(cc):
            cc = cc != z3.StringVal('')
        c = z3.And(c, cc)
    for cc in GLOBAL_CONSTRAINTS:
        logging.debug(cc)

        c = z3.And(c, cc)

    for type_info in infered_types:
        if infered_types[type_info] == '':
            continue
        cc = z3.String('type:' + type_info) == z3.StringVal(infered_types[type_info])
        logging.debug(cc)
        c = z3.And(c, cc)

    for identifier in MAKE_UNSOLVABLE:
        cc = z3.String(identifier) == z3.StringVal('')
        logging.debug(cc)

        c = z3.And(c, cc)

    # solver = z3.SolverFor('QF_LIA')
    solver = z3.Solver()
    solver.add(c)
    r = solver.check()
    if r == z3.unsat:
        if shouldPrint:
            eprint("no solution")
        return 'unsat'
    elif r == z3.unknown:
        if shouldPrint:
            eprint("failed to solve")

        return 'unsat'
        try:
            eprint(solver.model())
        except Exception:
            return
    else:
        model = solver.model()
        assignement = dict()
        types = dict()
        for decl in model.decls():
            if str(decl) == 'event':
                continue
            if str(decl)[:5] == 'type:':
                types[str(decl)[5:]] = AssignementsToString(model.get_interp(decl), model)
            else:
                assignement[str(decl)] = AssignementsToString(model.get_interp(decl), model)
        for identifier in GLOBAL_IDENTIFIER:
            if identifier not in assignement:
                if identifier == 'event':
                    continue
                logging.debug('Adding empty shizzle')
                assignement[identifier] = ''
        logging.debug(GLOBAL_IDENTIFIER)
        if shouldPrint:
            print(json.dumps({'assignements': assignement, 'types': types}))
        return {'assignements': assignement, 'types': types}


def main():
    input = sys.stdin.read()
    test = json.loads(input)
    solveConstrains(test['constraints'], test['types'])


if __name__ == '__main__':
    main()
