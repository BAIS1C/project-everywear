/**
 * Load.jsx — STUBBED FOR DEMO
 * Blockchain wallet loading disabled.
 * Original implementation preserved in git history.
 */
import React from 'react';
import styles from './Load.module.css';
import { ViewContext, ViewMode } from '../context/ViewContext';
import { SoundContext } from "../context/SoundContext"
import { AudioContext } from "../context/AudioContext"

function Load() {
    const { setViewMode } = React.useContext(ViewContext);
    const { playSound } = React.useContext(SoundContext)
    const { isMute } = React.useContext(AudioContext)

    const back = () => {
        setViewMode(ViewMode.LANDING)
        !isMute && playSound('backNextButton');
    }

    return (
        <div className={styles.container}>
            <div className={styles.message}>
                Wallet loading disabled for demo.
            </div>
            <button className={styles.button} onClick={() => back()}>Back</button>
        </div>
    );
}

export default Load;
