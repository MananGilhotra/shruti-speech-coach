import numpy as np

from shruti.align.ctc import ctc_viterbi
from shruti.text.words import count_syllables, expand_numbers, tokenize, word_error_rate


def test_numbers_and_abbreviations():
    assert expand_numbers("December 7th, 1941") == "December seventh, nineteen forty-one"
    toks = tokenize("Mr. Gorbachev, open this gate!")
    assert toks[0].chars == "MISTER" and toks[0].display == "Mr." and not toks[0].sentence_end
    assert toks[-1].sentence_end


def test_syllables():
    assert count_syllables("generation") == 4
    assert count_syllables("the") == 1


def test_wer():
    assert word_error_rate(["a", "b", "c"], ["a", "b", "c"]) == 0
    assert word_error_rate(["a", "b", "c"], ["a", "c"]) == 1 / 3


def test_ctc_viterbi_recovers_toy_alignment():
    # vocab: 0 blank, 1 'A', 2 'B'; frames: blank A A blank B B blank
    T, V = 7, 3
    lp = np.full((T, V), -10.0)
    for t, k in enumerate([0, 1, 1, 0, 2, 2, 0]):
        lp[t, k] = -0.01
    path = ctc_viterbi(lp, np.array([1, 2]), blank=0)
    assert list(path) == [-1, 0, 0, -1, 1, 1, -1]


def test_ctc_repeated_labels_need_a_blank():
    T, V = 5, 2
    lp = np.full((T, V), -5.0)
    for t, k in enumerate([1, 1, 0, 1, 1]):
        lp[t, k] = -0.01
    path = ctc_viterbi(lp, np.array([1, 1]), blank=0)
    assert list(path) == [0, 0, -1, 1, 1]
