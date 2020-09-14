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
from regex_parser import RegexParser, EMPTY, CHAR, DOT, STAR, BAR, CONCAT, GROUP, BACKREF, CARET, DOLLAR, CHARSET
import string
parser = RegexParser()

class NotSupportedException(Exception):
    pass

def getZ3(tuple):
    if tuple[0] == CONCAT:
        return z3.Concat(list(map(getZ3, list(tuple[1:]))))
    elif tuple[0] == STAR:
        return z3.Star(getZ3(tuple[1]))
    elif tuple[0] == DOT:
        res = z3.Range(chr(32), chr(127))
        return res
    elif tuple[0] == CHAR:
        return z3.Re(tuple[1])
    elif tuple[0] == BAR:
        return z3.Union(list(map(getZ3, list(tuple[1:]))))
    elif tuple[0] == GROUP:
        return getZ3(tuple[2])
    elif tuple[0] == EMPTY:
        return z3.Empty(z3.ReSort(z3.StringSort()))
    raise NotSupportedException('not yet supported', tuple[0])


def regex_to_z3(regex):
    free_start = True
    free_end = True
    if regex[0] == '^':
        free_start = False
        regex = regex[1:]
    if regex[-1] == '$':
        free_end = False
        regex = regex[:-1]

    regex = regex.replace('\\w', '[a-zA-Z0-9_]')
    regex = regex.replace('\\d', '[0-9]')
    regex = regex.replace('\\W', '[^A-Za-z0-9_]')

    parsed = parser.parse(regex)
    z3_regex = getZ3(parsed['root'])

    if free_start:
        z3_regex = z3.Concat(z3.Star(z3.Range(chr(32), chr(127))), z3_regex)
    if free_end:
        z3_regex = z3.Concat(z3_regex, z3.Star(z3.Range(chr(32), chr(127))))
    return z3_regex


if __name__ == '__main__':
    regex_to_z3('(a|b)')
